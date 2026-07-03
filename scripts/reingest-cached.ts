/**
 * Re-ingest a council from its already-downloaded raw files, without
 * re-discovering or re-downloading. Use this after a column-mapper fix to
 * rebuild a council's transactions from the exact set of files currently
 * cached in `data/raw/<slug>/` (avoids losing history if the council's
 * transparency page no longer lists older files).
 *
 * Usage:
 *   npx tsx scripts/reingest-cached.ts --slug kirklees
 *
 * Preserves the existing source_documents URLs where possible, clears the
 * council's transactions / source_documents / suppliers / financial_years,
 * then re-runs ingestFile over every cached spreadsheet.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";
import { ingestFile } from "./lib/ingest";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");

function parseArgs(): { slug: string } {
  const args = process.argv.slice(2);
  let slug: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) slug = args[++i];
  }
  if (!slug) {
    console.error("Usage: reingest-cached.ts --slug <council-slug>");
    process.exit(1);
  }
  return { slug };
}

function main() {
  const { slug } = parseArgs();
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  const council = db
    .select()
    .from(schema.councils)
    .where(eq(schema.councils.slug, slug))
    .get();
  if (!council) {
    console.error(`Council "${slug}" not found in registry`);
    process.exit(1);
  }
  const councilId = council.id;

  const rawDir = path.join(process.cwd(), "data", "raw", slug);
  if (!fs.existsSync(rawDir)) {
    console.error(`No cached raw dir at ${rawDir}`);
    process.exit(1);
  }

  // Preserve existing source-document URLs so re-ingested rows keep their
  // real provenance link.
  const urlByFilename = new Map<string, string>();
  for (const d of db
    .select({ filename: schema.sourceDocuments.filename, url: schema.sourceDocuments.url })
    .from(schema.sourceDocuments)
    .where(eq(schema.sourceDocuments.councilId, councilId))
    .all()) {
    urlByFilename.set(d.filename, d.url);
  }

  // Clear in FK-safe order.
  console.log(`Clearing existing data for "${slug}" (id=${councilId})...`);
  sqlite.prepare("DELETE FROM transactions WHERE council_id = ?").run(councilId);
  sqlite.prepare("DELETE FROM source_documents WHERE council_id = ?").run(councilId);
  sqlite.prepare("DELETE FROM suppliers WHERE council_id = ?").run(councilId);
  sqlite.prepare("DELETE FROM financial_years WHERE council_id = ?").run(councilId);

  const files = fs
    .readdirSync(rawDir)
    .filter((f) => /\.(xlsx|xls|csv)$/i.test(f))
    .sort();
  console.log(`Re-ingesting ${files.length} cached file(s)...`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let errors = 0;
  for (const file of files) {
    const filePath = path.join(rawDir, file);
    const fileUrl = urlByFilename.get(file) || `cached:${slug}/${file}`;
    try {
      const result = ingestFile({ councilId, filePath, fileUrl, db, sqlite });
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
    } catch (err) {
      errors++;
      console.error(`  [error] ${file}: ${String(err).slice(0, 120)}`);
    }
  }

  console.log(
    `\nDone: ${totalInserted.toLocaleString()} inserted, ` +
      `${totalSkipped.toLocaleString()} skipped, ${errors} errors.`
  );
  sqlite.close();
}

main();
