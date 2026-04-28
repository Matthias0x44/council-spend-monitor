import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import * as path from "path";

const LOCAL_DB = path.join(process.cwd(), "data", "council-spend.db");

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables");
  process.exit(1);
}

async function main() {
  // Debug: show credential shape (not values) to diagnose secrets issues
  const urlTrimmed = TURSO_URL!.trim();
  const tokenTrimmed = TURSO_TOKEN!.trim();
  console.log(`TURSO_URL length=${TURSO_URL!.length}, trimmed=${urlTrimmed.length}, starts_with_libsql=${urlTrimmed.startsWith("libsql://")}, preview=${urlTrimmed.slice(0, 40)}...`);
  console.log(`TURSO_TOKEN length=${TURSO_TOKEN!.length}, trimmed=${tokenTrimmed.length}, starts_with_eyJ=${tokenTrimmed.startsWith("eyJ")}`);

  console.log(`Reading local database: ${LOCAL_DB}`);
  const local = new Database(LOCAL_DB, { readonly: true });
  const turso = createClient({ url: urlTrimmed, authToken: tokenTrimmed });

  // Test connection first
  try {
    const r = await turso.execute("SELECT 1 as ok");
    console.log("Turso connection OK");
  } catch (err) {
    console.error("Cannot connect to Turso:", err);
    process.exit(1);
  }

  // Use hardcoded DDL that we know works with Turso
  const DDL_STATEMENTS = [
    "DROP TABLE IF EXISTS transactions",
    "DROP TABLE IF EXISTS budgets",
    "DROP TABLE IF EXISTS outturns",
    "DROP TABLE IF EXISTS source_documents",
    "DROP TABLE IF EXISTS suppliers",
    "DROP TABLE IF EXISTS financial_years",
    "DROP TABLE IF EXISTS councils",

    `CREATE TABLE IF NOT EXISTS councils (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      region TEXT,
      transparency_url TEXT,
      data_gov_id TEXT,
      scrape_profile TEXT,
      scrape_status TEXT DEFAULT 'pending',
      last_scraped_at TEXT,
      file_pattern TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS financial_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      label TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      name TEXT NOT NULL,
      normalised_name TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS source_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      financial_year_id INTEGER REFERENCES financial_years(id),
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      downloaded_at TEXT,
      column_mapping TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
      directorate TEXT,
      service TEXT,
      category TEXT,
      net_budget REAL,
      gross_budget REAL
    )`,
    `CREATE TABLE IF NOT EXISTS outturns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
      directorate TEXT,
      service TEXT,
      net_outturn REAL,
      variance REAL
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
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
    )`,

    "CREATE INDEX IF NOT EXISTS fy_council_idx ON financial_years(council_id)",
    "CREATE INDEX IF NOT EXISTS supplier_normalised_idx ON suppliers(council_id, normalised_name)",
    "CREATE INDEX IF NOT EXISTS source_doc_council_idx ON source_documents(council_id)",
    "CREATE INDEX IF NOT EXISTS source_doc_url_idx ON source_documents(url)",
    "CREATE INDEX IF NOT EXISTS budget_fy_idx ON budgets(financial_year_id)",
    "CREATE INDEX IF NOT EXISTS outturn_fy_idx ON outturns(financial_year_id)",
    "CREATE INDEX IF NOT EXISTS txn_council_date_idx ON transactions(council_id, date)",
    "CREATE INDEX IF NOT EXISTS txn_supplier_idx ON transactions(supplier_id)",
    "CREATE INDEX IF NOT EXISTS txn_directorate_idx ON transactions(council_id, directorate)",
    "CREATE INDEX IF NOT EXISTS txn_category_idx ON transactions(council_id, category)",
    "CREATE INDEX IF NOT EXISTS txn_month_idx ON transactions(council_id, month)",
    "CREATE INDEX IF NOT EXISTS txn_fy_idx ON transactions(council_id, financial_year_id)",
  ];

  console.log("Creating schema...");
  for (const stmt of DDL_STATEMENTS) {
    const preview = stmt.trim().slice(0, 60);
    try {
      await turso.execute(stmt);
      console.log(`  OK: ${preview}...`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL: ${preview}... → ${msg}`);
    }
  }

  // Copy data — insert order respects FK constraints
  const TABLE_ORDER = [
    "councils",
    "financial_years",
    "suppliers",
    "source_documents",
    "budgets",
    "outturns",
    "transactions",
  ];

  for (const tableName of TABLE_ORDER) {
    const count = (local.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get() as { c: number }).c;
    console.log(`\nPushing ${tableName}: ${count.toLocaleString()} rows`);
    if (count === 0) continue;

    const cols = local.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    const placeholders = colNames.map(() => "?").join(", ");
    const insertSQL = `INSERT INTO ${tableName} (${colNames.join(", ")}) VALUES (${placeholders})`;

    const BATCH_SIZE = 200;
    let offset = 0;

    while (offset < count) {
      const rows = local
        .prepare(`SELECT * FROM "${tableName}" LIMIT ${BATCH_SIZE} OFFSET ${offset}`)
        .all() as Record<string, unknown>[];

      const statements = rows.map((row) => ({
        sql: insertSQL,
        args: colNames.map((col) => {
          const v = row[col];
          if (v === null || v === undefined) return null;
          if (typeof v === "number" || typeof v === "string") return v;
          return String(v);
        }),
      }));

      try {
        await turso.batch(statements);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Batch error at offset ${offset}: ${msg}`);
        // Try smaller batches
        for (const stmt of statements) {
          try { await turso.execute(stmt); } catch { /* skip */ }
        }
      }

      offset += rows.length;
      if (offset % 10000 < BATCH_SIZE) {
        console.log(`  ${offset.toLocaleString()} / ${count.toLocaleString()}`);
      }
    }
  }

  turso.close();
  local.close();
  console.log("\nDone! Data pushed to Turso.");
}

main().catch((err) => {
  console.error("Push failed:", err);
  process.exit(1);
});
