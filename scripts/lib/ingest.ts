import { documentFingerprint } from "./fingerprint";
/**
 * Generic ingestion module for council spending spreadsheets.
 *
 * Reads CSV/XLSX files, auto-detects columns, normalises data,
 * and inserts into the database via better-sqlite3 (local pipeline).
 */

import { createHash } from "node:crypto";
import { fiscalWindow, fiscalLabel } from "../../src/lib/fiscal";
import { classifyService } from "../../src/lib/classifier";
import { parseAmount, parseDate, monthFromFilename } from "./parse";
export { monthFromFilename } from "./parse";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import {
  detectColumns,
  applyMapping,
  validateSupplierColumn,
  validateAmountColumn,
  validateServiceColumn,
  type ColumnMapping,
} from "./column-mapper";

export interface IngestOptions {
  councilId: number;
  councilSlug: string;
  scrapeProfile?: Record<string, string> | null;
  filePath: string;
  fileUrl: string;
  db: ReturnType<typeof drizzle>;
  sqlite: InstanceType<typeof Database>;
  /** Optional publication threshold; defaults to 0 so published small payments and credits remain. */
  minAmount?: number;
  /** Optional stricter month cutoff. The rolling five-FY window always applies; undated rows need a source month. */
  sinceMonth?: string;
}

export interface IngestResult {
  inserted: number;
  skipped: number;
  columnMapping: ColumnMapping;
  sourceMappings?: Record<string, ColumnMapping>;
  missingRequired: string[];
}

function normaliseSupplierName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s&]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect whether a buffer looks like Windows-1252 / Latin-1 rather than UTF-8.
 * Some councils (notably Stockport) publish CSVs in cp1252 where the pound
 * sign appears as raw 0xA3. Reading those bytes as UTF-8 produces replacement
 * characters and breaks amount parsing.
 */
function looksLikeCp1252(buf: Buffer): boolean {
  let highBytes = 0;
  let invalidUtf8 = 0;
  const limit = Math.min(buf.length, 64 * 1024);
  for (let i = 0; i < limit; i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    highBytes++;
    // Validate as UTF-8 continuation: a 0xC2..0xF4 byte should be followed
    // by 1..3 0x80..0xBF bytes. Anything else is suspicious.
    if (b >= 0xc2 && b <= 0xf4) {
      const next = buf[i + 1];
      if (next === undefined || next < 0x80 || next > 0xbf) invalidUtf8++;
      else i++; // skip one continuation byte
    } else {
      invalidUtf8++;
    }
  }
  return highBytes > 0 && invalidUtf8 / Math.max(1, highBytes) > 0.5;
}

function sheetToRows(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  // Some councils put a title/preamble row above the real header
  // (e.g. Wirral: "Payments for Publishing for Invoices paid between…").
  // Probe the first few rows for one that looks like a header.
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];
  if (matrix.length === 0) return [];

  const headerScore = (cells: unknown[]): number => {
    const joined = cells.map((c) => String(c || "").toLowerCase()).join(" ");
    let score = 0;
    if (/supplier|vendor|payee|beneficiary|merchant/.test(joined)) score += 2;
    if (/amount|paid|value|net|gross|invoiced/.test(joined)) score += 2;
    if (/date|period/.test(joined)) score += 1;
    if (cells.filter((c) => String(c || "").trim()).length >= 3) score += 1;
    return score;
  };

  let headerIdx = 0;
  let best = -1;
  for (let i = 0; i < Math.min(50, matrix.length); i++) {
    const s = headerScore(matrix[i] || []);
    if (s > best) {
      best = s;
      headerIdx = i;
    }
  }

  const headers = (matrix[headerIdx] || []).map((h, i) => {
    const s = String(h || "").trim();
    return s || `column_${i}`;
  });
  const rows: Record<string, unknown>[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    if (cells.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    rows.push(obj);
  }
  return rows;
}

function readSpreadsheet(filePath: string, profile?: Record<string, string> | null, sourceMappings: Record<string, ColumnMapping> = {}): Record<string, unknown>[] {
  const buf = fs.readFileSync(filePath);
  const isCsv = filePath.toLowerCase().endsWith(".csv");

  const workbook = isCsv && looksLikeCp1252(buf)
    ? XLSX.read(new TextDecoder("windows-1252").decode(buf), { type: "string", raw: true })
    : XLSX.read(buf, { type: "buffer", raw: true });
  const sheets = workbook.SheetNames.map(name => ({name,rows:sheetToRows(workbook.Sheets[name])})).filter(sheet => sheet.rows.length);
  const accepted = sheets.filter(({rows}) => detectColumns(Object.keys(rows[0]), profile ?? undefined).missingRequired.length === 0);
  if (!accepted.length) return sheets[0]?.rows || [];
  return accepted.flatMap(({name,rows}) => {
    const headers = Object.keys(rows[0]);
    let mapping = detectColumns(headers, profile ?? undefined).mapping;
    mapping = validateSupplierColumn(mapping, rows, headers).mapping;
    mapping = validateAmountColumn(mapping, rows, headers).mapping;
    mapping = validateServiceColumn(mapping, rows, headers).mapping;
    sourceMappings[name] = mapping;
    return rows.map(row => applyMapping(row, mapping));
  });
}

/**
 * Ingest a single spreadsheet file for a council.
 * Returns the number of rows inserted, or null if the file
 * had missing required columns.
 */
export function ingestFile(opts: IngestOptions): IngestResult {
  // Parsing and replacement are atomic: failures leave the old file intact.
  return opts.sqlite.transaction(() => ingestFileAtomic(opts))();
}

function ingestFileAtomic(opts: IngestOptions): IngestResult {
  const { councilId, filePath, fileUrl, db, sqlite } = opts;
  const filename = path.basename(filePath);
  const envMin = Number(process.env.MIN_TXN_AMOUNT ?? 0);
  const minAmount =
    opts.minAmount !== undefined
      ? opts.minAmount
      : Number.isFinite(envMin)
      ? envMin
      : 0;

  const sinceMonth =
    opts.sinceMonth ?? process.env.SINCE_MONTH ?? fiscalWindow().start.slice(0, 7);
  const window = fiscalWindow();
  const cutoff = sinceMonth > window.start.slice(0, 7) ? sinceMonth : window.start.slice(0, 7);

  // Read spreadsheet
  const sourceMappings: Record<string, ColumnMapping> = {};
  const rows = readSpreadsheet(filePath, opts.scrapeProfile, sourceMappings);
  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, columnMapping: {}, missingRequired: [] };
  }

  // Auto-detect or apply override column mapping
  const headers = Object.keys(rows[0]);
  const profileOverride = opts.scrapeProfile
    ? opts.scrapeProfile
    : undefined;

  const detection = detectColumns(headers, profileOverride);

  if (detection.missingRequired.length > 0) {
    console.warn(
      `  [skip] ${filename}: missing required columns: ${detection.missingRequired.join(", ")}`
    );
    return {
      inserted: 0,
      skipped: rows.length,
      columnMapping: detection.mapping,
      missingRequired: detection.missingRequired,
    };
  }

  // Sanity-check the chosen supplier column against actual values.
  // Catches cases like Bristol's "Body Name" column (an OS Linked Data
  // URI for the publishing council) being mistaken for the supplier.
  const supplierCheck = validateSupplierColumn(detection.mapping, rows, headers);
  if (supplierCheck.warning) {
    console.warn(`  [warn] ${filename}: ${supplierCheck.warning}`);
  }
  detection.mapping = supplierCheck.mapping;

  // Same for the amount column — Stockport's "Summary of Purpose of
  // Expenditure" header substring-matches the "expenditure" variant but
  // holds free-text descriptions, not numbers.
  const amountCheck = validateAmountColumn(detection.mapping, rows, headers);
  if (amountCheck.warning) {
    console.warn(`  [warn] ${filename}: ${amountCheck.warning}`);
  }
  detection.mapping = amountCheck.mapping;

  // And the service column — many councils publish a numeric cost-centre
  // *code* ("Cost Centre" = 660789) that exact-matches a `service` variant;
  // swap it for the human-readable description when one exists.
  const serviceCheck = validateServiceColumn(detection.mapping, rows, headers);
  if (serviceCheck.warning) {
    console.warn(`  [warn] ${filename}: ${serviceCheck.warning}`);
  }
  detection.mapping = serviceCheck.mapping;

  // Determine file month/FY from filename
  const fileMonth = monthFromFilename(filename) || monthFromFilename(fileUrl);
  const fileFyLabel = fileMonth ? fiscalLabel(fileMonth) : "";
  const isProcCard = filename.toLowerCase().includes("purchase-card");
  const docType = isProcCard ? "procurement_card" : "expenditure";

  // FY and supplier caches (scoped to this council)
  const fyCache = new Map<string, number>();
  const supplierCache = new Map<string, number>();

  function getOrCreateFY(label: string): number {
    if (!label) return 0;
    if (fyCache.has(label)) return fyCache.get(label)!;
    const existing = db
      .select()
      .from(schema.financialYears)
      .where(
        and(
          eq(schema.financialYears.councilId, councilId),
          eq(schema.financialYears.label, label)
        )
      )
      .get();
    if (existing) {
      fyCache.set(label, existing.id);
      return existing.id;
    }
    const parts = label.split("-");
    const startYear = parseInt(parts[0]);
    const startDate = `${startYear}-04-01`;
    const endDate = `${startYear + 1}-03-31`;
    db.insert(schema.financialYears)
      .values({ councilId, label, startDate, endDate })
      .run();
    const fy = db
      .select()
      .from(schema.financialYears)
      .where(
        and(
          eq(schema.financialYears.councilId, councilId),
          eq(schema.financialYears.label, label)
        )
      )
      .get();
    fyCache.set(label, fy!.id);
    return fy!.id;
  }

  function getOrCreateSupplier(name: string): number {
    const normalised = normaliseSupplierName(name);
    if (supplierCache.has(normalised)) return supplierCache.get(normalised)!;
    const existing = db
      .select()
      .from(schema.suppliers)
      .where(
        and(
          eq(schema.suppliers.councilId, councilId),
          eq(schema.suppliers.normalisedName, normalised)
        )
      )
      .get();
    if (existing) {
      supplierCache.set(normalised, existing.id);
      return existing.id;
    }
    db.insert(schema.suppliers)
      .values({ councilId, name, normalisedName: normalised })
      .run();
    const supplier = db
      .select()
      .from(schema.suppliers)
      .where(
        and(
          eq(schema.suppliers.councilId, councilId),
          eq(schema.suppliers.normalisedName, normalised)
        )
      )
      .get();
    supplierCache.set(normalised, supplier!.id);
    return supplier!.id;
  }

  // Replace only this URL after parsing succeeds. This preserves repeated real
  // payment lines while making retries and --force idempotent.
  const priorDocs = sqlite.prepare("SELECT id FROM source_documents WHERE council_id = ? AND url = ?").all(councilId, fileUrl) as { id: number }[];
  for (const doc of priorDocs) {
    sqlite.prepare("DELETE FROM transactions WHERE source_document_id = ?").run(doc.id);
    sqlite.prepare("DELETE FROM source_documents WHERE id = ?").run(doc.id);
  }
  // Exact duplicate downloads under different URLs must not double count.
  const contentHash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const duplicate = sqlite.prepare("SELECT id FROM source_documents WHERE council_id = ? AND content_hash = ?").get(councilId, contentHash);
  if (duplicate) return { inserted: 0, skipped: rows.length, columnMapping: detection.mapping, missingRequired: [] };
  // Create source document record
  const fyId = fileFyLabel ? getOrCreateFY(fileFyLabel) : null;
  db.insert(schema.sourceDocuments)
    .values({
      councilId,
      financialYearId: fyId,
      filename,
      url: fileUrl,
      type: docType,
      downloadedAt: new Date().toISOString(),
      columnMapping: JSON.stringify(detection.mapping),
      contentHash,
    })
    .run();

  const sourceDoc = db
    .select()
    .from(schema.sourceDocuments)
    .where(
      and(
        eq(schema.sourceDocuments.councilId, councilId),
        eq(schema.sourceDocuments.url, fileUrl)
      )
    )
    .get();
  const sourceDocId = sourceDoc!.id;

  // Prepare batch insert
  const insertTxn = sqlite.prepare(`
    INSERT INTO transactions (council_id, financial_year_id, supplier_id, service, directorate, category, description, amount, date, month, source_document_id, service_classification, classification_method, classification_evidence, classifier_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batchInsert = sqlite.transaction(
    (txns: {
      councilId: number;
      fyId: number | null;
      supplierId: number;
      service: string;
      directorate: string;
      category: string;
      description: string;
      amount: number;
      date: string;
      month: string;
      sourceDocId: number;
      classification: ReturnType<typeof classifyService>;
    }[]) => {
      for (const t of txns) {
        insertTxn.run(
          t.councilId, t.fyId, t.supplierId, t.service, t.directorate,
          t.category, t.description, t.amount, t.date, t.month, t.sourceDocId,
          t.classification.label, t.classification.method, t.classification.evidence, t.classification.version
        );
      }
    }
  );

  const batch: Parameters<typeof batchInsert>[0] = [];
  let skipped = 0;

  for (const row of rows) {
    const mapped = applyMapping(row, detection.mapping);

    const rawSupplier = String(mapped.supplier || "").trim();
    const rawDateStr = String(mapped.date || "").trim();
    const rawDesc = String(mapped.description || "").trim();
    const amount = parseAmount(mapped.amount);
    if (amount === null || amount === 0) { skipped++; continue; }
    if (/^(grand\s+)?total(?:\s+(?:payments|spend|expenditure|amount))?\s*:?\s*$/i.test(rawSupplier) || (!rawSupplier && /^(grand\s+)?total(?:\s+(?:payments|spend|expenditure|amount))?\s*:?\s*$/i.test(rawDesc))) { skipped++; continue; }

    // An explicit threshold is optional; default 0 retains published small payments.
    // Uses absolute value so micro-refunds are filtered along with micro-payments.
    if (minAmount > 0 && Math.abs(amount) < minAmount) {
      skipped++;
      continue;
    }

    // Skip summary/totals rows: many councils append a grand-total line at the
    // bottom of each file with only an amount populated. We treat any row with
    // no supplier, no date, and no description as such a summary line.
    if (!rawSupplier && !rawDateStr && !rawDesc) {
      skipped++;
      continue;
    }

    const rawDate = mapped.date;
    const date = parseDate(rawDate as string | number);
    const txMonth = date ? date.slice(0, 7) : fileMonth;

    // Cap to recent financial years. When a cutoff is active we also drop
    // rows we can't date at all (no parseable transaction date and no month
    // in the filename): an undated row can't be confirmed to fall inside the
    // window, and keeping them lets stale files with unrecognised date
    // formats leak years of old data past the cutoff.
    if (!txMonth || txMonth < cutoff || txMonth >= window.endExclusive.slice(0, 7) || (date ? date > window.through : txMonth > window.through.slice(0, 7))) {
      skipped++;
      continue;
    }

    const supplierName = rawSupplier || "Not supplied";
    const supplierId = getOrCreateSupplier(supplierName);
    const txFyLabel = txMonth ? fiscalLabel(txMonth) : fileFyLabel;
    const rowFyId = txFyLabel ? getOrCreateFY(txFyLabel) : null;

    batch.push({
      councilId,
      fyId: rowFyId,
      supplierId,
      service: String(mapped.service || "").trim(),
      directorate: String(mapped.directorate || "").trim(),
      category: String(mapped.category || "").trim(),
      description: String(mapped.description || "").trim(),
      amount,
      date: date || "",
      month: txMonth || "",
      sourceDocId: sourceDocId,
      classification: classifyService({ service: String(mapped.service || ""), directorate: String(mapped.directorate || ""), description: rawDesc, category: String(mapped.category || "") }),
    });
  }

  const semanticHash = documentFingerprint(batch);
  const equivalent = batch.length ? sqlite.prepare("SELECT id FROM source_documents WHERE council_id = ? AND semantic_hash = ? AND id <> ?").get(councilId, semanticHash, sourceDocId) : null;
  if (equivalent) {
    sqlite.prepare("DELETE FROM source_documents WHERE id = ?").run(sourceDocId);
    return { inserted: 0, skipped: rows.length, columnMapping: detection.mapping, missingRequired: [] };
  }
  sqlite.prepare("UPDATE source_documents SET semantic_hash = ? WHERE id = ?").run(semanticHash, sourceDocId);
  batchInsert(batch);

  return {
    inserted: batch.length,
    sourceMappings,
    skipped,
    columnMapping: detection.mapping,
    missingRequired: [],
  };
}
