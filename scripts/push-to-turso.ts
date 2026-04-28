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

// Drop order respects foreign key dependencies (children first)
const DROP_ORDER = [
  "transactions",
  "budgets",
  "outturns",
  "source_documents",
  "suppliers",
  "financial_years",
  "councils",
];

async function main() {
  console.log(`Reading local database: ${LOCAL_DB}`);
  const local = new Database(LOCAL_DB, { readonly: true });
  const turso = createClient({ url: TURSO_URL!, authToken: TURSO_TOKEN });

  // Drop all tables in FK-safe order
  console.log("Dropping existing tables...");
  for (const table of DROP_ORDER) {
    try {
      await turso.execute(`DROP TABLE IF EXISTS "${table}"`);
    } catch (err) {
      console.warn(`  Could not drop ${table}: ${err}`);
    }
  }

  // Get table DDL and create in reverse drop order (parents first)
  const tables = local
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string; sql: string }[];

  console.log(`Found ${tables.length} tables: ${tables.map((t) => t.name).join(", ")}`);

  const createOrder = [...DROP_ORDER].reverse();
  for (const tableName of createOrder) {
    const table = tables.find((t) => t.name === tableName);
    if (!table) continue;
    console.log(`Creating table: ${table.name}`);
    const ddl = table.sql.replace(/CREATE TABLE/, "CREATE TABLE IF NOT EXISTS");
    await turso.execute(ddl);
  }

  // Create indexes
  const indexes = local
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
    .all() as { sql: string }[];

  for (const idx of indexes) {
    const safeSQL = idx.sql.replace(/CREATE INDEX/, "CREATE INDEX IF NOT EXISTS");
    try {
      await turso.execute(safeSQL);
    } catch {
      // index may reference a column or table that doesn't exist in this schema version
    }
  }
  console.log(`Created ${indexes.length} indexes`);

  // Copy data table by table in batches (parents first)
  for (const tableName of createOrder) {
    const table = tables.find((t) => t.name === tableName);
    if (!table) continue;

    const count = (local.prepare(`SELECT COUNT(*) as c FROM "${table.name}"`).get() as { c: number }).c;
    console.log(`Pushing ${table.name}: ${count.toLocaleString()} rows`);
    if (count === 0) continue;

    const cols = local.prepare(`PRAGMA table_info("${table.name}")`).all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    const placeholders = colNames.map(() => "?").join(", ");
    const insertSQL = `INSERT INTO "${table.name}" (${colNames.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`;

    const BATCH_SIZE = 200;
    let offset = 0;

    while (offset < count) {
      const rows = local
        .prepare(`SELECT * FROM "${table.name}" LIMIT ${BATCH_SIZE} OFFSET ${offset}`)
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

      await turso.batch(statements);
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
