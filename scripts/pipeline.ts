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
import { ingestFile, monthFromFilename } from "./lib/ingest";

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

function parseArgs(): {
  slug?: string;
  slugs?: string[];
  status?: string;
  concurrency: number;
  since?: string;
} {
  const args = process.argv.slice(2);
  let slug: string | undefined;
  let slugs: string[] | undefined;
  let status: string | undefined;
  let concurrency = 5;
  let since: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) slug = args[++i];
    if (args[i] === "--slugs" && args[i + 1])
      slugs = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    if (args[i] === "--status" && args[i + 1]) status = args[++i];
    if (args[i] === "--concurrency" && args[i + 1]) concurrency = parseInt(args[++i]);
    if (args[i] === "--since" && args[i + 1]) since = args[++i];
  }

  return { slug, slugs, status, concurrency, since };
}

async function processCouncil(
  councilRow: typeof schema.councils.$inferSelect,
  db: ReturnType<typeof drizzle>,
  sqlite: InstanceType<typeof Database>,
  sinceMonth?: string
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

  // File-level date cutoff: skip files whose filename clearly indicates a
  // month before the cutoff. This avoids downloading years of history we're
  // going to drop at ingest anyway. Files without a parseable month in the
  // filename are kept and filtered row-by-row during ingest.
  if (sinceMonth) {
    const before = files.length;
    files = files.filter((f) => {
      const m = monthFromFilename(f.filename);
      return !m || m >= sinceMonth;
    });
    if (files.length !== before) {
      console.log(
        `  Skipped ${before - files.length} file(s) dated before ${sinceMonth}`
      );
    }
  }

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
        sinceMonth,
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
  const { slug, slugs, status, concurrency, since } = parseArgs();
  const sinceMonth = since || process.env.SINCE_MONTH;
  if (sinceMonth) {
    console.log(`Date cutoff: keeping transactions dated ${sinceMonth} or later`);
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  // Create tables if they don't exist (fresh DB on CI). The canonical
  // DDL lives in scripts/d1/schema.sql so it stays in sync with what we
  // apply to Cloudflare D1.
  const schemaSql = fs.readFileSync(
    path.join(process.cwd(), "scripts", "d1", "schema.sql"),
    "utf8"
  );
  sqlite.exec(schemaSql);

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
  } else if (slugs && slugs.length > 0) {
    councils = [];
    for (const s of slugs) {
      const c = db
        .select()
        .from(schema.councils)
        .where(eq(schema.councils.slug, s))
        .get();
      if (!c) {
        console.warn(`  Skipping unknown slug '${s}' (not in registry)`);
        continue;
      }
      councils.push(c);
    }
    if (councils.length === 0) {
      console.error("None of the requested slugs exist in the registry");
      process.exit(1);
    }
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
      batch.map((c) => processCouncil(c, db, sqlite, sinceMonth))
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
