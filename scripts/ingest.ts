import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const RAW_DIR = path.join(process.cwd(), "data", "raw", "kirklees");

function normaliseSupplierName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s&]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Map actual Kirklees column names to our canonical names
const COLUMN_MAP: Record<string, string> = {
  // Expenditure files (consistent across all years)
  "vendor name": "supplier",
  "vendor number": "vendor_number",
  "amount excluding vat": "amount",
  "payment date": "date",
  "cost centre description": "service",
  "proclass description": "category",
  "purpose of spend": "description",

  // Purchase card files
  "mch.merchant name": "supplier",
  "mch.merchant name - original": "supplier",
  "fin.net transaction amount": "amount",
  "fin.transaction date": "date",
  "acc.default accounting code 01 description": "service",
  "mch.mcc description": "category",
  "fin.accounting code 02 description": "description",

  // Generic fallbacks
  supplier: "supplier",
  "supplier name": "supplier",
  amount: "amount",
  "amount paid": "amount",
  date: "date",
  service: "service",
  directorate: "directorate",
  category: "category",
  description: "description",
};

function mapColumns(
  row: Record<string, unknown>
): { supplier: string; amount: number; service: string; directorate: string; category: string; description: string; date: string | number } | null {
  const mapped: Record<string, string | number> = {};

  for (const [rawKey, value] of Object.entries(row)) {
    const key = rawKey.toLowerCase().trim();
    const canonical = COLUMN_MAP[key];
    if (canonical && !mapped[canonical] && value != null && value !== "") {
      mapped[canonical] = value as string | number;
    }
  }

  const supplier = String(mapped.supplier || "").trim();
  if (!supplier || supplier === "REDACTED DATA" || supplier === "Redacted Personal Data" || supplier === "Redacted Commercial Confidentiality") {
    // Still record redacted transactions for totals
  }

  let amount = 0;
  if (typeof mapped.amount === "number") {
    amount = mapped.amount;
  } else if (typeof mapped.amount === "string") {
    amount = parseFloat(mapped.amount.replace(/[£,]/g, "")) || 0;
  }

  // Skip rows with no supplier AND no amount
  if (!supplier && amount === 0) return null;
  // Skip zero-amount rows
  if (amount === 0) return null;

  return {
    supplier: supplier || "Redacted",
    amount,
    service: String(mapped.service || "").trim(),
    directorate: String(mapped.directorate || "").trim(),
    category: String(mapped.category || "").trim(),
    description: String(mapped.description || "").trim(),
    date: mapped.date ?? "",
  };
}

function parseExcelDate(value: string | number): string {
  if (typeof value === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  if (typeof value === "string" && value) {
    // Try parsing common UK date formats
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
  // KC-Published-Data-2024-06-30.xlsx → 2024-06
  const match = filename.match(/(\d{4})[- ](\d{2})[- ]\d{2}/);
  if (match) return `${match[1]}-${match[2]}`;
  return "";
}

function financialYearFromMonth(month: string): string {
  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr);
  const m = parseInt(monthStr);
  const startYear = m >= 4 ? year : year - 1;
  const endShort = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${startYear}-${endShort}`;
}

function readSpreadsheet(filePath: string): Record<string, unknown>[] {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  // Create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS councils (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      region TEXT
    );
    CREATE TABLE IF NOT EXISTS financial_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      label TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      name TEXT NOT NULL,
      normalised_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      financial_year_id INTEGER REFERENCES financial_years(id),
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      downloaded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
      directorate TEXT,
      service TEXT,
      category TEXT,
      net_budget REAL,
      gross_budget REAL
    );
    CREATE TABLE IF NOT EXISTS outturns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
      directorate TEXT,
      service TEXT,
      net_outturn REAL,
      variance REAL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      financial_year_id INTEGER REFERENCES financial_years(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      service TEXT,
      directorate TEXT,
      category TEXT,
      description TEXT,
      amount REAL NOT NULL,
      date TEXT,
      month TEXT,
      source_document_id INTEGER REFERENCES source_documents(id)
    );
    CREATE INDEX IF NOT EXISTS fy_council_idx ON financial_years(council_id);
    CREATE INDEX IF NOT EXISTS supplier_normalised_idx ON suppliers(council_id, normalised_name);
    CREATE INDEX IF NOT EXISTS source_doc_council_idx ON source_documents(council_id);
    CREATE INDEX IF NOT EXISTS budget_fy_idx ON budgets(financial_year_id);
    CREATE INDEX IF NOT EXISTS outturn_fy_idx ON outturns(financial_year_id);
    CREATE INDEX IF NOT EXISTS txn_council_date_idx ON transactions(council_id, date);
    CREATE INDEX IF NOT EXISTS txn_supplier_idx ON transactions(supplier_id);
    CREATE INDEX IF NOT EXISTS txn_directorate_idx ON transactions(council_id, directorate);
    CREATE INDEX IF NOT EXISTS txn_category_idx ON transactions(council_id, category);
    CREATE INDEX IF NOT EXISTS txn_month_idx ON transactions(council_id, month);
    CREATE INDEX IF NOT EXISTS txn_fy_idx ON transactions(council_id, financial_year_id);
  `);

  // Upsert Kirklees council
  let council = db
    .select()
    .from(schema.councils)
    .where(eq(schema.councils.slug, "kirklees"))
    .get();

  if (!council) {
    db.insert(schema.councils)
      .values({ name: "Kirklees Council", slug: "kirklees", region: "West Yorkshire" })
      .run();
    council = db
      .select()
      .from(schema.councils)
      .where(eq(schema.councils.slug, "kirklees"))
      .get();
  }
  const councilId = council!.id;

  // Cache for financial years and suppliers
  const fyCache = new Map<string, number>();
  const supplierCache = new Map<string, number>();

  function getOrCreateFY(label: string): number {
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

    // Parse "2024-25" → start 2024-04-01, end 2025-03-31
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
    const cacheKey = normalised;
    if (supplierCache.has(cacheKey)) return supplierCache.get(cacheKey)!;

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
      supplierCache.set(cacheKey, existing.id);
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

    supplierCache.set(cacheKey, supplier!.id);
    return supplier!.id;
  }

  // Process all expenditure files
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`No raw data directory found at ${RAW_DIR}. Run scrape.ts first.`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(RAW_DIR)
    .filter((f) => /\.(xlsx|csv)$/i.test(f))
    .sort();

  console.log(`Found ${files.length} spreadsheet files to ingest`);

  // Clear existing transactions for re-ingestion
  sqlite.exec("DELETE FROM transactions");
  sqlite.exec("DELETE FROM source_documents WHERE type IN ('expenditure', 'procurement_card')");

  const insertTxn = sqlite.prepare(`
    INSERT INTO transactions (council_id, financial_year_id, supplier_id, service, directorate, category, description, amount, date, month, source_document_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batchInsert = sqlite.transaction(
    (
      txns: {
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
      }[]
    ) => {
      for (const t of txns) {
        insertTxn.run(
          t.councilId,
          t.fyId,
          t.supplierId,
          t.service,
          t.directorate,
          t.category,
          t.description,
          t.amount,
          t.date,
          t.month,
          t.sourceDocId
        );
      }
    }
  );

  let totalRows = 0;
  let skippedRows = 0;

  for (const file of files) {
    const filePath = path.join(RAW_DIR, file);
    const isProcCard = file.toLowerCase().includes("purchase-card");
    const docType = isProcCard ? "procurement_card" : "expenditure";

    const month = monthFromFilename(file);
    const fyLabel = month ? financialYearFromMonth(month) : "";

    // Create source document
    db.insert(schema.sourceDocuments)
      .values({
        councilId,
        financialYearId: fyLabel ? getOrCreateFY(fyLabel) : null,
        filename: file,
        url: `https://www.kirklees.gov.uk/beta/information-and-data/pdf/open-data/expenditure/${encodeURIComponent(file)}`,
        type: docType,
        downloadedAt: new Date().toISOString(),
      })
      .run();

    const sourceDoc = db
      .select()
      .from(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.filename, file))
      .get();

    const sourceDocId = sourceDoc!.id;

    console.log(`Processing ${file}...`);
    let rows: Record<string, unknown>[];
    try {
      rows = readSpreadsheet(filePath);
    } catch (err) {
      console.error(`  Failed to read ${file}:`, err);
      continue;
    }

    const batch: Parameters<typeof batchInsert>[0] = [];

    for (const row of rows) {
      const mapped = mapColumns(row);
      if (!mapped) {
        skippedRows++;
        continue;
      }

      const supplierId = getOrCreateSupplier(mapped.supplier);
      const date = parseExcelDate(mapped.date as string | number);
      const txMonth = date ? date.slice(0, 7) : month;
      const txFyLabel = txMonth ? financialYearFromMonth(txMonth) : fyLabel;
      const fyId = txFyLabel ? getOrCreateFY(txFyLabel) : null;

      batch.push({
        councilId,
        fyId,
        supplierId,
        service: mapped.service,
        directorate: mapped.directorate,
        category: mapped.category,
        description: mapped.description,
        amount: mapped.amount,
        date: date || "",
        month: txMonth || "",
        sourceDocId,
      });
    }

    batchInsert(batch);
    totalRows += batch.length;
    console.log(`  Inserted ${batch.length} transactions (skipped ${rows.length - batch.length})`);
  }

  console.log(`\nIngestion complete:`);
  console.log(`  Total transactions: ${totalRows}`);
  console.log(`  Skipped rows: ${skippedRows}`);
  console.log(`  Suppliers: ${supplierCache.size}`);
  console.log(`  Financial years: ${fyCache.size}`);

  sqlite.close();
}

main();
