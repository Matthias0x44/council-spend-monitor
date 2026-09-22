/**
 * Probe active councils that have transparency_url but no transactions,
 * keep only those whose HTML discovery finds spreadsheet links.
 *
 * Usage: npx tsx scripts/probe-transparency-urls.ts
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { discoverFiles } from "./lib/discover";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const OUT = path.join(process.cwd(), "data", "transparency-probe.json");

async function main() {
  const sqlite = new Database(DB_PATH);
  const rows = sqlite
    .prepare(
      `SELECT slug, name, transparency_url AS url
       FROM councils
       WHERE scrape_status = 'active'
         AND id NOT IN (SELECT DISTINCT council_id FROM transactions)
         AND transparency_url IS NOT NULL AND length(transparency_url) > 0`
    )
    .all() as { slug: string; name: string; url: string }[];

  console.log(`Probing ${rows.length} councils...`);
  const good: Array<{ slug: string; name: string; files: number }> = [];
  const bad: Array<{ slug: string; reason: string }> = [];

  for (let i = 0; i < rows.length; i += 6) {
    const batch = rows.slice(i, i + 6);
    const results = await Promise.all(
      batch.map(async (r) => {
        try {
          const files = await discoverFiles({
            slug: r.slug,
            name: r.name,
            transparencyUrl: r.url,
            dataGovId: null, // force HTML path
          });
          return { slug: r.slug, name: r.name, n: files.length };
        } catch (e) {
          return { slug: r.slug, name: r.name, n: 0, err: String(e).slice(0, 120) };
        }
      })
    );
    for (const r of results) {
      if (r.n > 0) {
        good.push({ slug: r.slug, name: r.name, files: r.n });
        console.log(`  GOOD ${r.slug} (${r.n} files)`);
        sqlite
          .prepare(`UPDATE councils SET scrape_status = 'active' WHERE slug = ?`)
          .run(r.slug);
      } else {
        bad.push({ slug: r.slug, reason: (r as { err?: string }).err || "0 files" });
        console.log(`  BAD  ${r.slug}`);
        sqlite
          .prepare(`UPDATE councils SET scrape_status = 'pending' WHERE slug = ?`)
          .run(r.slug);
      }
    }
  }

  sqlite.exec(
    `UPDATE councils SET scrape_status='active'
     WHERE id IN (SELECT DISTINCT council_id FROM transactions)`
  );

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        goodCount: good.length,
        badCount: bad.length,
        good,
        bad,
      },
      null,
      2
    )
  );
  console.log(`\nGood: ${good.length} → ${OUT}`);
  console.log(good.map((g) => g.slug).join(","));
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
