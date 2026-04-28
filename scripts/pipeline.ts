/**
 * Pipeline orchestrator: loops over the council registry,
 * discovers new files, downloads them, and ingests into the local DB.
 *
 * Usage:
 *   npx tsx scripts/pipeline.ts                 # process all active councils
 *   npx tsx scripts/pipeline.ts --slug kirklees # process one council
 *   npx tsx scripts/pipeline.ts --status pending # process councils by status
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as path from "path";
import * as fs from "fs";
import { discoverFiles, downloadFile, type DiscoveredFile } from "./lib/discover";
import { ingestFile } from "./lib/ingest";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const RAW_DIR = path.join(process.cwd(), "data", "raw");

interface PipelineStats {
  slug: string;
  filesDiscovered: number;
  filesNew: number;
  totalInserted: number;
  totalSkipped: number;
  errors: string[];
}

function parseArgs(): { slug?: string; status?: string; concurrency: number } {
  const args = process.argv.slice(2);
  let slug: string | undefined;
  let status: string | undefined;
  let concurrency = 5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) slug = args[++i];
    if (args[i] === "--status" && args[i + 1]) status = args[++i];
    if (args[i] === "--concurrency" && args[i + 1]) concurrency = parseInt(args[++i]);
  }

  return { slug, status, concurrency };
}

async function processCouncil(
  councilRow: typeof schema.councils.$inferSelect,
  db: ReturnType<typeof drizzle>,
  sqlite: InstanceType<typeof Database>
): Promise<PipelineStats> {
  const stats: PipelineStats = {
    slug: councilRow.slug,
    filesDiscovered: 0,
    filesNew: 0,
    totalInserted: 0,
    totalSkipped: 0,
    errors: [],
  };

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Processing: ${councilRow.name} (${councilRow.slug})`);
  console.log(`${"=".repeat(60)}`);

  // Discover files
  let files: DiscoveredFile[];
  try {
    files = await discoverFiles({
      slug: councilRow.slug,
      name: councilRow.name,
      transparencyUrl: councilRow.transparencyUrl,
      dataGovId: councilRow.dataGovId,
      filePattern: councilRow.filePattern,
    });
  } catch (err) {
    const msg = `Discovery failed: ${err}`;
    console.error(`  ${msg}`);
    stats.errors.push(msg);
    return stats;
  }

  stats.filesDiscovered = files.length;
  console.log(`  Found ${files.length} files`);

  // Filter to new files only (not already in source_documents)
  const existingUrls = new Set(
    db
      .select({ url: schema.sourceDocuments.url })
      .from(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.councilId, councilRow.id))
      .all()
      .map((r) => r.url)
  );

  const newFiles = files.filter((f) => !existingUrls.has(f.url));
  stats.filesNew = newFiles.length;

  if (newFiles.length === 0) {
    console.log("  No new files to ingest");
    return stats;
  }

  console.log(`  ${newFiles.length} new files to process`);

  // Parse scrape profile
  let scrapeProfile: Record<string, string> | null = null;
  if (councilRow.scrapeProfile) {
    try {
      scrapeProfile = JSON.parse(councilRow.scrapeProfile);
    } catch {
      console.warn("  Invalid scrape_profile JSON, using auto-detection");
    }
  }

  // Download and ingest each new file
  const councilDir = path.join(RAW_DIR, councilRow.slug);

  for (const file of newFiles) {
    try {
      console.log(`  Downloading ${file.filename}...`);
      const localPath = await downloadFile(file.url, councilDir, file.filename);

      console.log(`  Ingesting ${file.filename}...`);
      const result = ingestFile({
        councilId: councilRow.id,
        councilSlug: councilRow.slug,
        scrapeProfile,
        filePath: localPath,
        fileUrl: file.url,
        db,
        sqlite,
      });

      stats.totalInserted += result.inserted;
      stats.totalSkipped += result.skipped;

      if (result.missingRequired.length > 0) {
        stats.errors.push(
          `${file.filename}: missing columns ${result.missingRequired.join(", ")}`
        );
      } else {
        console.log(`    Inserted ${result.inserted} rows (skipped ${result.skipped})`);
      }
    } catch (err) {
      const msg = `${file.filename}: ${err}`;
      console.error(`    Error: ${msg}`);
      stats.errors.push(msg);
    }
  }

  return stats;
}

async function main() {
  const { slug, status, concurrency } = parseArgs();

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  // Create tables if they don't exist (fresh DB on CI)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS councils (
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
      downloaded_at TEXT,
      column_mapping TEXT
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
    CREATE INDEX IF NOT EXISTS source_doc_url_idx ON source_documents(url);
    CREATE INDEX IF NOT EXISTS budget_fy_idx ON budgets(financial_year_id);
    CREATE INDEX IF NOT EXISTS outturn_fy_idx ON outturns(financial_year_id);
    CREATE INDEX IF NOT EXISTS txn_council_date_idx ON transactions(council_id, date);
    CREATE INDEX IF NOT EXISTS txn_supplier_idx ON transactions(supplier_id);
    CREATE INDEX IF NOT EXISTS txn_directorate_idx ON transactions(council_id, directorate);
    CREATE INDEX IF NOT EXISTS txn_category_idx ON transactions(council_id, category);
    CREATE INDEX IF NOT EXISTS txn_month_idx ON transactions(council_id, month);
    CREATE INDEX IF NOT EXISTS txn_fy_idx ON transactions(council_id, financial_year_id);
  `);

  // Migrate existing DBs that may be missing new columns
  const migrations = [
    "ALTER TABLE councils ADD COLUMN transparency_url TEXT",
    "ALTER TABLE councils ADD COLUMN data_gov_id TEXT",
    "ALTER TABLE councils ADD COLUMN scrape_profile TEXT",
    "ALTER TABLE councils ADD COLUMN scrape_status TEXT DEFAULT 'pending'",
    "ALTER TABLE councils ADD COLUMN last_scraped_at TEXT",
    "ALTER TABLE councils ADD COLUMN file_pattern TEXT",
    "ALTER TABLE source_documents ADD COLUMN column_mapping TEXT",
  ];
  for (const m of migrations) {
    try { sqlite.exec(m); } catch { /* column already exists */ }
  }

  // Fetch councils to process
  let councils: (typeof schema.councils.$inferSelect)[];
  if (slug) {
    const c = db
      .select()
      .from(schema.councils)
      .where(eq(schema.councils.slug, slug))
      .get();
    if (!c) {
      console.error(`Council '${slug}' not found in registry`);
      process.exit(1);
    }
    councils = [c];
  } else {
    const targetStatus = status || "active";
    councils = db
      .select()
      .from(schema.councils)
      .where(eq(schema.councils.scrapeStatus, targetStatus))
      .all();
  }

  console.log(`Processing ${councils.length} council(s)...`);

  const allStats: PipelineStats[] = [];

  // Process in batches for concurrency
  for (let i = 0; i < councils.length; i += concurrency) {
    const batch = councils.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((c) => processCouncil(c, db, sqlite))
    );
    allStats.push(...batchResults);

    // Update scrape status for each council in this batch
    for (let j = 0; j < batch.length; j++) {
      const council = batch[j];
      const stats = batchResults[j];
      const newStatus = stats.errors.length > 0 && stats.totalInserted === 0
        ? "failing"
        : "active";

      sqlite.exec(`
        UPDATE councils
        SET scrape_status = '${newStatus}',
            last_scraped_at = '${new Date().toISOString()}'
        WHERE id = ${council.id}
      `);
    }
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("  Pipeline Summary");
  console.log(`${"=".repeat(60)}`);
  for (const s of allStats) {
    const status = s.errors.length > 0 ? "WARN" : "OK";
    console.log(
      `  [${status}] ${s.slug}: discovered=${s.filesDiscovered} new=${s.filesNew} inserted=${s.totalInserted} skipped=${s.totalSkipped} errors=${s.errors.length}`
    );
    for (const err of s.errors) {
      console.log(`        ${err}`);
    }
  }

  const totalInserted = allStats.reduce((s, r) => s + r.totalInserted, 0);
  const totalErrors = allStats.reduce((s, r) => s + r.errors.length, 0);
  console.log(`\nTotal: ${totalInserted} rows inserted, ${totalErrors} errors`);

  sqlite.close();
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
