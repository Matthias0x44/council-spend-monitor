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

function monthFromFilename(filename: string): string {
  const match = filename.match(/(\d{4})[- _](\d{2})[- _]\d{2}/);
  if (match) return `${match[1]}-${match[2]}`;
  const monthMatch = filename.match(/(\d{4})[- _](\d{2})/);
  if (monthMatch) return `${monthMatch[1]}-${monthMatch[2]}`;
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

function readSpreadsheet(filePath: string): Record<string, unknown>[] {
  const buf = fs.readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

/**
 * Ingest a single spreadsheet file for a council.
 * Returns the number of rows inserted, or null if the file
 * had missing required columns.
 */
export function ingestFile(opts: IngestOptions): IngestResult {
  const { councilId, filePath, fileUrl, db, sqlite } = opts;
  const filename = path.basename(filePath);

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
  const validated = validateSupplierColumn(detection.mapping, rows, headers);
  if (validated.warning) {
    console.warn(`  [warn] ${filename}: ${validated.warning}`);
  }
  detection.mapping = validated.mapping;

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

    // Skip summary/totals rows: many councils append a grand-total line at the
    // bottom of each file with only an amount populated. We treat any row with
    // no supplier, no date, and no description as such a summary line.
    if (!rawSupplier && !rawDateStr && !rawDesc) {
      skipped++;
      continue;
    }

    const supplierName = rawSupplier || "Redacted";
    const supplierId = getOrCreateSupplier(supplierName);
    const rawDate = mapped.date;
    const date = parseExcelDate(rawDate as string | number);
    const txMonth = date ? date.slice(0, 7) : fileMonth;
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
