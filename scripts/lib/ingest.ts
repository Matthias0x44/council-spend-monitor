/**
 * Generic ingestion module for council spending spreadsheets.
 *
 * Reads CSV/XLSX files, auto-detects columns, normalises data,
 * and inserts into the database via better-sqlite3 (local pipeline).
 */

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
  type CanonicalField,
} from "./column-mapper";

export interface IngestOptions {
  councilId: number;
  councilSlug: string;
  scrapeProfile?: Record<string, string> | null;
  filePath: string;
  fileUrl: string;
  db: ReturnType<typeof drizzle>;
  sqlite: InstanceType<typeof Database>;
  /**
   * Drop rows where `|amount|` is below this threshold. The UK Local
   * Government Transparency Code only mandates publishing transactions
   * over £500, so anything smaller is best-effort extra data that bloats
   * storage without much analytical value. Set to 0 to disable.
   *
   * Defaults to MIN_TXN_AMOUNT env var, then 500.
   */
  minAmount?: number;
  /**
   * Drop rows whose transaction month is before this `YYYY-MM` cutoff.
   * Used to cap ingestion to the most recent financial years so D1 stays
   * within its storage budget. Rows with an unparseable date are kept
   * (the file-level filter in the pipeline handles bulk old files).
   *
   * Defaults to the SINCE_MONTH env var, else undefined (no cutoff).
   */
  sinceMonth?: string;
}

export interface IngestResult {
  inserted: number;
  skipped: number;
  columnMapping: ColumnMapping;
  missingRequired: string[];
}

function normaliseSupplierName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s&]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseExcelDate(value: string | number): string {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  if (typeof value === "string" && value) {
    const ddmmyyyy = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    }
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return "";
}

const MONTH_NAME_TO_NUM: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function monthFromFilename(filename: string): string {
  // ISO-ish: 2024-04-01 / 2024_04 / 2024 04
  const match = filename.match(/(\d{4})[- _](\d{2})[- _]\d{2}/);
  if (match) return `${match[1]}-${match[2]}`;
  const monthMatch = filename.match(/(\d{4})[- _](\d{2})(?!\d)/);
  if (monthMatch) {
    const mm = parseInt(monthMatch[2]);
    if (mm >= 1 && mm <= 12) return `${monthMatch[1]}-${monthMatch[2]}`;
  }

  // Month-name formats used by many stale/legacy feeds, in either order:
  //   "payments-april2010", "february_2012_payments", "Published September 2010",
  //   "2011-march", "spend-oct-2024"
  const lower = filename.toLowerCase();
  const nameThenYear = lower.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^0-9]{0,4}(\d{4})/
  );
  if (nameThenYear) {
    const mm = MONTH_NAME_TO_NUM[nameThenYear[1]];
    const yyyy = nameThenYear[2];
    if (mm && +yyyy >= 2000 && +yyyy <= 2100) return `${yyyy}-${mm}`;
  }
  const yearThenName = lower.match(
    /(\d{4})[^0-9]{0,4}(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/
  );
  if (yearThenName) {
    const mm = MONTH_NAME_TO_NUM[yearThenName[2]];
    const yyyy = yearThenName[1];
    if (mm && +yyyy >= 2000 && +yyyy <= 2100) return `${yyyy}-${mm}`;
  }

  return "";
}

function financialYearFromMonth(month: string): string {
  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr);
  const m = parseInt(monthStr);
  if (isNaN(year) || isNaN(m)) return "";
  const startYear = m >= 4 ? year : year - 1;
  const endShort = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${startYear}-${endShort}`;
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

function readSpreadsheet(filePath: string): Record<string, unknown>[] {
  const buf = fs.readFileSync(filePath);
  const isCsv = filePath.toLowerCase().endsWith(".csv");

  // SheetJS assumes UTF-8 for CSVs and silently produces replacement chars
  // for bytes that aren't valid UTF-8. Some councils (Stockport's "All
  // Spend" CSVs) publish in Windows-1252 where 0xA3 = £; decode those
  // ourselves so amounts like "£3,340" parse instead of becoming NaN.
  if (isCsv && looksLikeCp1252(buf)) {
    const decoder = new TextDecoder("windows-1252");
    const text = decoder.decode(buf);
    const workbook = XLSX.read(text, { type: "string", raw: false });
    const sheetName = workbook.SheetNames[0];
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  }

  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
}

/**
 * Ingest a single spreadsheet file for a council.
 * Returns the number of rows inserted, or null if the file
 * had missing required columns.
 */
export function ingestFile(opts: IngestOptions): IngestResult {
  const { councilId, filePath, fileUrl, db, sqlite } = opts;
  const filename = path.basename(filePath);
  const envMin = Number(process.env.MIN_TXN_AMOUNT);
  const minAmount =
    opts.minAmount !== undefined
      ? opts.minAmount
      : Number.isFinite(envMin)
      ? envMin
      : 500;

  const sinceMonth =
    opts.sinceMonth !== undefined ? opts.sinceMonth : process.env.SINCE_MONTH;

  // Read spreadsheet
  const rows = readSpreadsheet(filePath);
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
  const fileMonth = monthFromFilename(filename);
  const fileFyLabel = fileMonth ? financialYearFromMonth(fileMonth) : "";
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
    })
    .run();

  const sourceDoc = db
    .select()
    .from(schema.sourceDocuments)
    .where(eq(schema.sourceDocuments.filename, filename))
    .get();
  const sourceDocId = sourceDoc!.id;

  // Prepare batch insert
  const insertTxn = sqlite.prepare(`
    INSERT INTO transactions (council_id, financial_year_id, supplier_id, service, directorate, category, description, amount, date, month, source_document_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    }[]) => {
      for (const t of txns) {
        insertTxn.run(
          t.councilId, t.fyId, t.supplierId, t.service, t.directorate,
          t.category, t.description, t.amount, t.date, t.month, t.sourceDocId
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
    let amount = 0;
    if (typeof mapped.amount === "number") {
      amount = mapped.amount;
    } else if (typeof mapped.amount === "string") {
      amount = parseFloat(String(mapped.amount).replace(/[£,]/g, "")) || 0;
    }

    if (amount === 0) {
      skipped++;
      continue;
    }

    // Drop sub-threshold rows (default £500 — UK Transparency Code minimum).
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
    const date = parseExcelDate(rawDate as string | number);
    const txMonth = date ? date.slice(0, 7) : fileMonth;

    // Cap to recent financial years. When a cutoff is active we also drop
    // rows we can't date at all (no parseable transaction date and no month
    // in the filename): an undated row can't be confirmed to fall inside the
    // window, and keeping them lets stale files with unrecognised date
    // formats leak years of old data past the cutoff.
    if (sinceMonth && (!txMonth || txMonth < sinceMonth)) {
      skipped++;
      continue;
    }

    const supplierName = rawSupplier || "Redacted";
    const supplierId = getOrCreateSupplier(supplierName);
    const txFyLabel = txMonth ? financialYearFromMonth(txMonth) : fileFyLabel;
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
    });
  }

  batchInsert(batch);

  return {
    inserted: batch.length,
    skipped,
    columnMapping: detection.mapping,
    missingRequired: [],
  };
}
