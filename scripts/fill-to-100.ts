/**
 * Second-pass fill toward 100 ingested councils.
 *
 * The budget-ranked activate pass left many notables failing because curated
 * HTML transparency URLs 404. This script:
 *   1. Copies data_gov_id across known duplicate slugs (manchester ← manchester-city)
 *   2. Activates every LA-like council that has a CKAN id (and optional fresh signal)
 *   3. Re-ingests any data/raw/<slug>/ cache that has no transactions yet
 *
 * Usage:
 *   npx tsx scripts/fill-to-100.ts
 *   npx tsx scripts/fill-to-100.ts --skip-reingest
 *   Then: npx tsx scripts/pipeline.ts --status active --since 2024-04 --concurrency 5
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";
import { ingestFile } from "./lib/ingest";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const RAW_DIR = path.join(process.cwd(), "data", "raw");
const FRESH_PATH = path.join(process.cwd(), "data", "fresh-councils.json");

const SKIP_NAME_RE =
  /\b(nhs|ccg|pct|icb|trust|hospital|health|police|fire|park|department|ministry|agency|gallery|museum|archive|commission|office of|homes england|transport for|partnership|foundation|supreme court|armouries|spikes|standards board|monitor|natural environment|national fraud|centre for environment)\b/i;

const LA_NAME_RE =
  /\b(council|borough|county|city|unitary|metropolitan|london borough)\b/i;

/** Prefer CKAN-backed duplicate when both exist. */
const CKAN_DONORS: Record<string, string> = {
  manchester: "manchester-city",
  hounslow: "london-hounslow",
  plymouth: "plymouth-city",
  greenwich: "royal-greenwich",
  bromley: "london-bromley",
  hillingdon: "london-hillingdon",
  redbridge: "london-redbridge",
  sutton: "london-sutton",
  "richmond-upon-thames": "london-richmond-upon-thames",
  brighton: "brighton-and-hove-city",
  "brighton-and-hove": "brighton-and-hove-city",
  hull: "hull-city",
  derby: "derby-city",
};

function parseArgs(): { skipReingest: boolean } {
  return { skipReingest: process.argv.includes("--skip-reingest") };
}

function isLa(name: string): boolean {
  return LA_NAME_RE.test(name) && !SKIP_NAME_RE.test(name);
}

function reingestSlug(
  sqlite: InstanceType<typeof Database>,
  db: ReturnType<typeof drizzle>,
  slug: string,
  sinceMonth: string
): { inserted: number; skipped: number; errors: number } {
  const council = db
    .select()
    .from(schema.councils)
    .where(eq(schema.councils.slug, slug))
    .get();
  if (!council) return { inserted: 0, skipped: 0, errors: 1 };

  const rawDir = path.join(RAW_DIR, slug);
  if (!fs.existsSync(rawDir)) return { inserted: 0, skipped: 0, errors: 1 };

  const urlByFilename = new Map<string, string>();
  for (const d of db
    .select({
      filename: schema.sourceDocuments.filename,
      url: schema.sourceDocuments.url,
    })
    .from(schema.sourceDocuments)
    .where(eq(schema.sourceDocuments.councilId, council.id))
    .all()) {
    urlByFilename.set(d.filename, d.url);
  }

  sqlite.prepare("DELETE FROM transactions WHERE council_id = ?").run(council.id);
  sqlite.prepare("DELETE FROM source_documents WHERE council_id = ?").run(council.id);
  // Keep suppliers/FYs — ingest recreates as needed; clearing suppliers is
  // safer for clean reingest.
  sqlite.prepare("DELETE FROM suppliers WHERE council_id = ?").run(council.id);
  sqlite.prepare("DELETE FROM financial_years WHERE council_id = ?").run(council.id);

  const files = fs
    .readdirSync(rawDir)
    .filter((f) => /\.(csv|xlsx|xls)$/i.test(f))
    .sort();

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  for (const filename of files) {
    const filePath = path.join(rawDir, filename);
    const fileUrl =
      urlByFilename.get(filename) || `file://${slug}/${filename}`;
    try {
      const result = ingestFile({
        councilId: council.id,
        councilSlug: slug,
        scrapeProfile: council.scrapeProfile
          ? JSON.parse(council.scrapeProfile)
          : null,
        filePath,
        fileUrl,
        db,
        sqlite,
        sinceMonth,
      });
      inserted += result.inserted;
      skipped += result.skipped;
    } catch (err) {
      errors++;
      console.log(`    ${filename}: ${err}`);
    }
  }

  sqlite
    .prepare(
      `UPDATE councils SET scrape_status = ?, last_scraped_at = datetime('now') WHERE id = ?`
    )
    .run(errors && !inserted ? "failing" : "active", council.id);

  return { inserted, skipped, errors };
}

async function main() {
  const { skipReingest } = parseArgs();
  const sinceMonth = process.env.SINCE_MONTH || "2024-04";
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  // 1) Copy CKAN ids from donor duplicates
  let copied = 0;
  for (const [target, donor] of Object.entries(CKAN_DONORS)) {
    const d = sqlite
      .prepare(
        `SELECT data_gov_id FROM councils WHERE slug = ? AND data_gov_id IS NOT NULL AND data_gov_id != ''`
      )
      .get(donor) as { data_gov_id: string } | undefined;
    if (!d) continue;
    const info = sqlite
      .prepare(
        `UPDATE councils SET data_gov_id = COALESCE(NULLIF(data_gov_id,''), ?) WHERE slug = ?`
      )
      .run(d.data_gov_id, target);
    if (info.changes) copied++;
  }
  console.log(`Copied CKAN ids onto ${copied} duplicate slugs`);

  // 2) Activate LA-like councils with CKAN ids
  const freshSlugs = new Set<string>();
  if (fs.existsSync(FRESH_PATH)) {
    const fresh = JSON.parse(fs.readFileSync(FRESH_PATH, "utf8")) as {
      fresh: { slug: string }[];
    };
    for (const f of fresh.fresh) freshSlugs.add(f.slug);
  }

  const candidates = sqlite
    .prepare(
      `SELECT id, slug, name, data_gov_id FROM councils
       WHERE data_gov_id IS NOT NULL AND data_gov_id != ''`
    )
    .all() as { id: number; slug: string; name: string; data_gov_id: string }[];

  let activated = 0;
  for (const c of candidates) {
    if (!isLa(c.name)) continue;
    sqlite
      .prepare(`UPDATE councils SET scrape_status = 'active' WHERE id = ?`)
      .run(c.id);
    activated++;
  }
  // Also activate donor + target aliases and raw-dir councils
  for (const slug of [
    ...Object.keys(CKAN_DONORS),
    ...Object.values(CKAN_DONORS),
    ...fs.readdirSync(RAW_DIR),
  ]) {
    const row = sqlite
      .prepare(`SELECT id, name FROM councils WHERE slug = ?`)
      .get(slug) as { id: number; name: string } | undefined;
    if (!row) continue;
    if (!isLa(row.name) && !freshSlugs.has(slug)) continue;
    sqlite
      .prepare(`UPDATE councils SET scrape_status = 'active' WHERE id = ?`)
      .run(row.id);
    activated++;
  }
  console.log(`Activated LA-like CKAN / raw / alias councils (passes=${activated})`);

  const withTxns = new Set(
    (
      sqlite
        .prepare(
          `SELECT c.slug FROM councils c
           JOIN transactions t ON t.council_id = c.id
           GROUP BY c.id`
        )
        .all() as { slug: string }[]
    ).map((r) => r.slug)
  );
  console.log(`Already have transactions: ${withTxns.size}`);

  // 3) Reingest cached raw dirs missing transactions
  if (!skipReingest) {
    const rawSlugs = fs
      .readdirSync(RAW_DIR)
      .filter((s) => fs.statSync(path.join(RAW_DIR, s)).isDirectory())
      .filter((s) => !withTxns.has(s));

    console.log(`\nRe-ingesting ${rawSlugs.length} cached raw dirs (since ${sinceMonth})...`);
    for (const slug of rawSlugs) {
      console.log(`  ${slug}`);
      const r = reingestSlug(sqlite, db, slug, sinceMonth);
      console.log(
        `    inserted=${r.inserted} skipped=${r.skipped} errors=${r.errors}`
      );
    }
  }

  const finalCount = (
    sqlite
      .prepare(`SELECT count(DISTINCT council_id) AS n FROM transactions`)
      .get() as { n: number }
  ).n;
  const activeNoTxn = (
    sqlite
      .prepare(
        `SELECT count(*) AS n FROM councils c
         WHERE scrape_status = 'active'
           AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.council_id = c.id)`
      )
      .get() as { n: number }
  ).n;

  console.log(`\nCouncils with transactions: ${finalCount}`);
  console.log(`Active without transactions (need pipeline): ${activeNoTxn}`);
  console.log(
    `\nNext: npx tsx scripts/pipeline.ts --status active --since ${sinceMonth} --concurrency 5`
  );

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
