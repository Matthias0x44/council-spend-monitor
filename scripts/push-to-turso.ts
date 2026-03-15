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
  console.log(`Reading local database: ${LOCAL_DB}`);
  const local = new Database(LOCAL_DB, { readonly: true });

  const turso = createClient({ url: TURSO_URL!, authToken: TURSO_TOKEN });

  const tables = local
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string; sql: string }[];

  console.log(`Found ${tables.length} tables: ${tables.map((t) => t.name).join(", ")}`);

  // Create tables
  for (const table of tables) {
    console.log(`Creating table: ${table.name}`);
    await turso.execute(`DROP TABLE IF EXISTS ${table.name}`);
    await turso.execute(table.sql);
  }

  // Create indexes
  const indexes = local
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
    .all() as { sql: string }[];

  for (const idx of indexes) {
    const safeSQL = idx.sql.replace(/CREATE INDEX/, "CREATE INDEX IF NOT EXISTS");
    await turso.execute(safeSQL);
  }
  console.log(`Created ${indexes.length} indexes`);

  // Copy data table by table in batches
  for (const table of tables) {
    const count = (local.prepare(`SELECT COUNT(*) as c FROM ${table.name}`).get() as { c: number }).c;
    console.log(`Pushing ${table.name}: ${count.toLocaleString()} rows`);

    if (count === 0) continue;

    const cols = local.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    const placeholders = colNames.map(() => "?").join(", ");
    const insertSQL = `INSERT INTO ${table.name} (${colNames.join(", ")}) VALUES (${placeholders})`;

    const BATCH_SIZE = 200;
    let offset = 0;

    while (offset < count) {
      const rows = local
        .prepare(`SELECT * FROM ${table.name} LIMIT ${BATCH_SIZE} OFFSET ${offset}`)
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
