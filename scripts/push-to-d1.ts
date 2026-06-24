/**
 * Push the local SQLite database to Cloudflare D1 via the HTTP API.
 *
 * Two modes:
 *   --replace            (default) Wipe every table in D1, then push everything
 *                        from local. Use for the initial migration.
 *   --slug <slug>        Replace only the rows belonging to one council
 *                        (transactions, suppliers, source_documents,
 *                        financial_years, and the council row itself), plus
 *                        upsert the registry. Use for incremental scrapes.
 *
 * Required environment variables:
 *   CLOUDFLARE_ACCOUNT_ID   The account UUID (from `wrangler whoami` or the
 *                           dashboard sidebar)
 *   CLOUDFLARE_API_TOKEN    A token with `Account → D1 → Edit` permission
 *   D1_DATABASE_ID          The database UUID printed by
 *                           `wrangler d1 create council-spend`
 *
 * Optional:
 *   D1_DATABASE_NAME        Default: "council-spend" (used only in log output)
 *   PUSH_BATCH_SIZE         Rows per multi-row INSERT statement (default 100).
 *                           Lower this if you hit "too many bound variables"
 *                           or 1MB request size errors.
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const LOCAL_DB = path.join(process.cwd(), "data", "council-spend.db");

/**
 * Tiny zero-dep .env loader. We don't pull in `dotenv` since this is the
 * only place we need it, and Node's --env-file flag isn't reliably forwarded
 * through tsx in all setups.
 */
function loadDotenv(): void {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Override empty/unset shell vars too — earlier `source .env` calls
    // can leave keys exported as empty strings, which would otherwise
    // shadow the real values we're loading here.
    if (!process.env[key] && value !== "") {
      process.env[key] = value;
    }
  }
}

loadDotenv();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_ID = process.env.D1_DATABASE_ID;
const DB_NAME = process.env.D1_DATABASE_NAME || "council-spend";
const BATCH_SIZE = Number(process.env.PUSH_BATCH_SIZE || 100);

if (!ACCOUNT_ID || !API_TOKEN || !DB_ID) {
  console.error(
    "Missing required env vars. Set CLOUDFLARE_ACCOUNT_ID, " +
      "CLOUDFLARE_API_TOKEN, and D1_DATABASE_ID."
  );
  process.exit(1);
}

const D1_QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;
const D1_RAW_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/raw`;

interface D1Response {
  success: boolean;
  errors?: { code: number; message: string }[];
  messages?: string[];
  result?: unknown[];
}

async function d1Execute(
  sql: string,
  params: unknown[] = []
): Promise<D1Response> {
  const res = await fetch(D1_QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const json = (await res.json()) as D1Response;
  if (!res.ok || !json.success) {
    const msg =
      json.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(`D1 query failed (${msg})\n  SQL: ${sql.slice(0, 200)}`);
  }
  return json;
}

/**
 * Run several SQL statements in one HTTP call. D1's /raw endpoint accepts
 * a single semicolon-separated SQL string and is much faster for bulk loads
 * than sending each statement individually.
 */
async function d1RawExec(sqlBundle: string): Promise<void> {
  const res = await fetch(D1_RAW_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: sqlBundle }),
  });
  const json = (await res.json()) as D1Response;
  if (!res.ok || !json.success) {
    const msg =
      json.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(`D1 raw exec failed (${msg})`);
  }
}

function escapeLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

interface TableSpec {
  name: string;
  columns: string[];
  /** Optional WHERE clause (already SQL-escaped) for scoped pushes. */
  where?: string;
}

const TABLES: TableSpec[] = [
  {
    name: "councils",
    columns: [
      "id",
      "name",
      "slug",
      "region",
      "transparency_url",
      "data_gov_id",
      "scrape_profile",
      "scrape_status",
      "last_scraped_at",
      "file_pattern",
    ],
  },
  {
    name: "financial_years",
    columns: ["id", "council_id", "label", "start_date", "end_date"],
  },
  {
    name: "suppliers",
    columns: ["id", "council_id", "name", "normalised_name"],
  },
  {
    name: "source_documents",
    columns: [
      "id",
      "council_id",
      "financial_year_id",
      "filename",
      "url",
      "type",
      "downloaded_at",
      "column_mapping",
    ],
  },
  {
    name: "budgets",
    columns: [
      "id",
      "financial_year_id",
      "directorate",
      "service",
      "category",
      "net_budget",
      "gross_budget",
    ],
  },
  {
    name: "outturns",
    columns: [
      "id",
      "financial_year_id",
      "directorate",
      "service",
      "net_outturn",
      "variance",
    ],
  },
  {
    name: "transactions",
    columns: [
      "id",
      "council_id",
      "financial_year_id",
      "supplier_id",
      "service",
      "directorate",
      "category",
      "description",
      "amount",
      "date",
      "month",
      "source_document_id",
    ],
  },
];

function parseArgs(): { mode: "replace" | "slug"; slug?: string } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) {
      return { mode: "slug", slug: args[++i] };
    }
    if (args[i] === "--replace") return { mode: "replace" };
  }
  return { mode: "replace" };
}

async function ensureSchema(): Promise<void> {
  console.log("Applying schema (idempotent)...");
  const schema = fs.readFileSync(
    path.join(process.cwd(), "scripts", "d1", "schema.sql"),
    "utf8"
  );
  await d1RawExec(schema);
  console.log("  Schema OK");
}

async function clearAll(): Promise<void> {
  console.log("Clearing all tables in D1...");
  // Reverse dependency order so FK references stay valid.
  const order = [...TABLES].reverse();
  const bundle = order.map((t) => `DELETE FROM ${t.name};`).join("\n");
  await d1RawExec(bundle);
  console.log("  Cleared");
}

async function clearCouncilScope(slug: string, councilId: number): Promise<void> {
  console.log(`Clearing existing data for council "${slug}" (id=${councilId})...`);
  const stmts = [
    `DELETE FROM transactions WHERE council_id = ${councilId};`,
    `DELETE FROM source_documents WHERE council_id = ${councilId};`,
    `DELETE FROM suppliers WHERE council_id = ${councilId};`,
    `DELETE FROM outturns WHERE financial_year_id IN (SELECT id FROM financial_years WHERE council_id = ${councilId});`,
    `DELETE FROM budgets   WHERE financial_year_id IN (SELECT id FROM financial_years WHERE council_id = ${councilId});`,
    `DELETE FROM financial_years WHERE council_id = ${councilId};`,
  ];
  await d1RawExec(stmts.join("\n"));
  console.log("  Cleared");
}

async function pushTable(
  local: InstanceType<typeof Database>,
  table: TableSpec,
  whereClause = ""
): Promise<number> {
  const cols = table.columns;
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const startedAt = Date.now();

  // Use a streaming iterator so we don't materialise the full result set in
  // memory — `transactions` alone is 600k rows / ~120MB.
  const stmt = local.prepare(
    `SELECT ${cols.join(", ")} FROM ${table.name} ${whereClause}`
  );
  const totalRow = local
    .prepare(`SELECT COUNT(*) AS c FROM ${table.name} ${whereClause}`)
    .get() as { c: number };
  const total = totalRow.c;

  if (total === 0) {
    console.log(`  ${table.name}: 0 rows`);
    return 0;
  }

  let pushed = 0;
  let buffer: Record<string, unknown>[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const valuesSql = buffer
      .map(
        (row) =>
          `(${cols.map((c) => escapeLiteral(row[c])).join(", ")})`
      )
      .join(",\n  ");
    const sql = `INSERT INTO ${table.name} (${colList}) VALUES\n  ${valuesSql};`;
    await d1RawExec(sql);
    pushed += buffer.length;
    buffer = [];

    if (pushed % (BATCH_SIZE * 20) === 0 || pushed === total) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const rate = (pushed / Math.max(1, Date.now() - startedAt)) * 1000;
      console.log(
        `  ${table.name}: ${pushed.toLocaleString()}/${total.toLocaleString()} ` +
          `(${elapsed}s, ${rate.toFixed(0)} rows/s)`
      );
    }
  };

  for (const row of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
    buffer.push(row);
    if (buffer.length >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();

  return pushed;
}

async function main() {
  const { mode, slug } = parseArgs();
  console.log(`Pushing local SQLite → D1 (db=${DB_NAME}, mode=${mode}${slug ? `, slug=${slug}` : ""})`);
  console.log(`  Local DB: ${LOCAL_DB}`);

  if (!fs.existsSync(LOCAL_DB)) {
    console.error(`Local DB not found at ${LOCAL_DB}. Run the pipeline first.`);
    process.exit(1);
  }

  const local = new Database(LOCAL_DB, { readonly: true });

  // Quick connection probe
  try {
    await d1Execute("SELECT 1");
  } catch (err) {
    console.error("Cannot reach D1. Check credentials and database id.");
    console.error(err);
    process.exit(1);
  }
  console.log("D1 connection OK");

  await ensureSchema();

  if (mode === "replace") {
    await clearAll();
    let total = 0;
    for (const t of TABLES) {
      total += await pushTable(local, t);
    }
    console.log(`\nDone. ${total.toLocaleString()} rows pushed.`);
    return;
  }

  // Scoped per-council push.
  const council = local
    .prepare("SELECT id FROM councils WHERE slug = ?")
    .get(slug!) as { id: number } | undefined;
  if (!council) {
    console.error(`Council "${slug}" not found in local DB.`);
    process.exit(1);
  }
  const cid = council.id;

  // Always upsert the council row first, in case the registry changed.
  await d1Execute(
    `DELETE FROM councils WHERE id = ?`,
    [cid]
  );
  await pushTable(
    local,
    TABLES[0],
    `WHERE id = ${cid}`
  );

  await clearCouncilScope(slug!, cid);

  const scopedWhere: Record<string, string> = {
    financial_years: `WHERE council_id = ${cid}`,
    suppliers: `WHERE council_id = ${cid}`,
    source_documents: `WHERE council_id = ${cid}`,
    budgets: `WHERE financial_year_id IN (SELECT id FROM financial_years WHERE council_id = ${cid})`,
    outturns: `WHERE financial_year_id IN (SELECT id FROM financial_years WHERE council_id = ${cid})`,
    transactions: `WHERE council_id = ${cid}`,
  };

  let total = 0;
  for (const t of TABLES) {
    if (t.name === "councils") continue;
    total += await pushTable(local, t, scopedWhere[t.name] || "");
  }
  console.log(`\nDone. ${total.toLocaleString()} rows pushed for "${slug}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
