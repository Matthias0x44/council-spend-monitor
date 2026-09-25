/**
 * Re-ingest data/raw/<slug>/ for councils that have files but no transactions.
 * Usage: npx tsx scripts/reingest-raw.ts [slug ...]
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";
import { ingestFile } from "./lib/ingest";

const DB_PATH = process.env.LOCAL_DB_PATH || path.join(process.cwd(), "data", "council-spend.db");
const RAW = path.join(process.cwd(), "data", "raw");

function isHtml(p: string): boolean {
  const head = fs.readFileSync(p).slice(0, 160).toString("utf8").toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}

async function main() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  const withTxns = new Set(
    (
      sqlite
        .prepare(
          `SELECT c.slug FROM councils c
           JOIN transactions t ON t.council_id = c.id GROUP BY c.id`
        )
        .all() as { slug: string }[]
    ).map((r) => r.slug)
  );

  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const slugs =
    args.length > 0
      ? args
      : fs
          .readdirSync(RAW)
          .filter((s) => fs.statSync(path.join(RAW, s)).isDirectory())
          .filter((s) => !withTxns.has(s));

  for (const slug of slugs) {
    const council = db
      .select()
      .from(schema.councils)
      .where(eq(schema.councils.slug, slug))
      .get();
    if (!council) {
      console.log(`${slug}: no registry row`);
      continue;
    }
    const dir = path.join(RAW, slug);
    if (!fs.existsSync(dir)) {
      console.log(`${slug}: no raw dir`);
      continue;
    }
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(csv|xlsx|xls)$/i.test(f))
      .sort();
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    for (const f of files) {
      const fp = path.join(dir, f);
      if (isHtml(fp)) continue;
      try {
        const r = ingestFile({
          councilId: council.id,
          councilSlug: slug,
          scrapeProfile: council.scrapeProfile
            ? JSON.parse(council.scrapeProfile)
            : null,
          filePath: fp,
          fileUrl: `file://${slug}/${f}`,
          db,
          sqlite,
        });
        inserted += r.inserted;
        skipped += r.skipped;
      } catch (e) {
        errors++;
        console.log(`  err ${slug}/${f}: ${String(e).slice(0, 120)}`);
      }
    }
    if (inserted > 0) {
      sqlite
        .prepare(`UPDATE councils SET scrape_status = 'active' WHERE id = ?`)
        .run(council.id);
    }
    console.log(`${slug}: inserted=${inserted} skipped=${skipped} errors=${errors}`);
  }

  console.log(
    "TOTAL",
    sqlite.prepare(`SELECT count(DISTINCT council_id) n FROM transactions`).get()
  );
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
