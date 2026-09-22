/**
 * Probe CKAN packages for LA councils missing transactions and report
 * which ones still serve real spreadsheet bytes (not HTML error pages).
 *
 * Usage: npx tsx scripts/probe-ckan-downloads.ts
 * Writes data/ckan-downloadable.json
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const OUT = path.join(process.cwd(), "data", "ckan-downloadable.json");

const SKIP =
  /\b(nhs|ccg|pct|icb|trust|hospital|health|police|fire|park|department|ministry|agency|gallery|museum|archive|commission|partnership|foundation)\b/i;
const LA = /\b(council|borough|county|city|unitary|metropolitan|london borough)\b/i;

async function probeResource(url: string): Promise<"good" | "html" | "error"> {
  try {
    const fr = await fetch(url, {
      headers: { "User-Agent": "CouncilSpendMonitor/1.0 (transparency research)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!fr.ok) return "error";
    const buf = Buffer.from(await fr.arrayBuffer());
    if (buf.length < 200) return "error";
    const head = buf.slice(0, 120).toString("utf8").toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html")) return "html";
    return "good";
  } catch {
    return "error";
  }
}

async function main() {
  const sqlite = new Database(DB_PATH);
  const rows = sqlite
    .prepare(
      `SELECT c.slug, c.name, c.data_gov_id AS dataGovId
       FROM councils c
       WHERE c.data_gov_id IS NOT NULL AND length(c.data_gov_id) > 0
         AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.council_id = c.id)`
    )
    .all() as { slug: string; name: string; dataGovId: string }[];

  const candidates = rows.filter((r) => LA.test(r.name) && !SKIP.test(r.name));
  console.log(`Probing ${candidates.length} LA CKAN packages...`);

  const good: typeof candidates = [];
  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < candidates.length; i += 6) {
    const batch = candidates.slice(i, i + 6);
    const part = await Promise.all(
      batch.map(async (row) => {
        try {
          const res = await fetch(
            `https://data.gov.uk/api/action/package_show?id=${encodeURIComponent(row.dataGovId)}`
          );
          if (!res.ok) {
            return { ...row, good: 0, total: 0, reason: `ckan ${res.status}` };
          }
          const data = (await res.json()) as {
            result?: { resources?: { url: string; format?: string }[] };
          };
          const resources = (data.result?.resources || []).filter((r) =>
            ["csv", "xlsx", "xls"].includes((r.format || "").toLowerCase())
          );
          let g = 0;
          let html = 0;
          let err = 0;
          for (const r of resources.slice(0, 6)) {
            const status = await probeResource(r.url);
            if (status === "good") g++;
            else if (status === "html") html++;
            else err++;
            if (g >= 2) break; // enough signal
          }
          return {
            ...row,
            good: g,
            html,
            err,
            total: resources.length,
          };
        } catch (e) {
          return { ...row, good: 0, total: 0, reason: String(e).slice(0, 100) };
        }
      })
    );

    for (const p of part) {
      results.push(p);
      if ((p.good as number) > 0) {
        good.push(p as (typeof candidates)[0]);
        console.log(
          `  GOOD ${p.slug} good=${p.good}/${p.total} html=${p.html ?? 0}`
        );
      }
    }
    process.stdout.write(`  … ${Math.min(i + 6, candidates.length)}/${candidates.length}\n`);
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        probed: candidates.length,
        downloadable: good.length,
        councils: good,
        all: results,
      },
      null,
      2
    )
  );
  console.log(`\nDownloadable: ${good.length} → ${OUT}`);
  console.log(good.map((g) => g.slug).join(","));
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
