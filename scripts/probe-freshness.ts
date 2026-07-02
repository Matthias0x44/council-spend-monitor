/**
 * Probe every registry council that has a data.gov.uk CKAN id and work out
 * which ones still publish *recent* spend files (within the 2-FY window).
 *
 * The auto-seeded registry contains hundreds of councils whose CKAN feeds
 * were abandoned around 2010-2014. This probe separates the live feeds
 * (worth scraping now) from the dead ones (need manual source curation
 * later), so we can focus on the easily-accessible councils first.
 *
 * A council counts as "fresh" if any csv/xlsx/xls resource either:
 *   - has a filename that parses to a month >= the cutoff, OR
 *   - has a CKAN last_modified/created date >= the cutoff (catches rolling
 *     "year-to-date" files whose name has no month, like East Devon's).
 *
 * Usage:
 *   npx tsx scripts/probe-freshness.ts                 # cutoff 2024-04
 *   npx tsx scripts/probe-freshness.ts --since 2024-04 --concurrency 12
 *
 * Writes the fresh shortlist to data/fresh-councils.json.
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { discoverViaCkan, type DiscoveredFile } from "./lib/discover";
import { monthFromFilename } from "./lib/ingest";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const OUT_PATH = path.join(process.cwd(), "data", "fresh-councils.json");

interface Args {
  since: string;
  concurrency: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let since = "2024-04";
  let concurrency = 12;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since" && argv[i + 1]) since = argv[++i];
    if (argv[i] === "--concurrency" && argv[i + 1]) concurrency = parseInt(argv[++i]);
  }
  return { since, concurrency };
}

interface CouncilRow {
  id: number;
  name: string;
  slug: string;
  data_gov_id: string;
}

interface ProbeResult {
  slug: string;
  name: string;
  recentFiles: number;
  totalFiles: number;
  newestSignal: string; // month or modified date that qualified
  error?: string;
}

function isRecent(file: DiscoveredFile, sinceMonth: string): { ok: boolean; signal: string } {
  const fnMonth = monthFromFilename(file.filename);
  if (fnMonth && fnMonth >= sinceMonth) return { ok: true, signal: fnMonth };
  if (file.modified) {
    // last_modified is an ISO-ish timestamp; compare its YYYY-MM prefix.
    const mod = file.modified.slice(0, 7);
    if (mod >= sinceMonth) return { ok: true, signal: `mod:${mod}` };
  }
  // Filename has no month AND no usable modified date: can't tell from
  // metadata alone. Treat as a weak candidate (rolling file) only if the
  // filename has no year at all (pure "payments-over-500" style).
  if (!fnMonth && !file.modified && !/\d{4}/.test(file.filename)) {
    return { ok: true, signal: "rolling?" };
  }
  return { ok: false, signal: "" };
}

async function probeCouncil(c: CouncilRow, sinceMonth: string): Promise<ProbeResult> {
  try {
    const files = await discoverViaCkan(c.data_gov_id);
    let recent = 0;
    let newest = "";
    for (const f of files) {
      const r = isRecent(f, sinceMonth);
      if (r.ok) {
        recent++;
        if (r.signal > newest) newest = r.signal;
      }
    }
    return {
      slug: c.slug,
      name: c.name,
      recentFiles: recent,
      totalFiles: files.length,
      newestSignal: newest,
    };
  } catch (err) {
    return {
      slug: c.slug,
      name: c.name,
      recentFiles: 0,
      totalFiles: 0,
      newestSignal: "",
      error: String(err).slice(0, 80),
    };
  }
}

async function main() {
  const { since, concurrency } = parseArgs();
  const sqlite = new Database(DB_PATH, { readonly: true });
  const councils = sqlite
    .prepare(
      "SELECT id, name, slug, data_gov_id FROM councils " +
        "WHERE scrape_status = 'pending' AND data_gov_id IS NOT NULL " +
        "ORDER BY slug"
    )
    .all() as CouncilRow[];
  sqlite.close();

  console.log(
    `Probing ${councils.length} pending CKAN councils for files >= ${since} ` +
      `(concurrency ${concurrency})...`
  );

  const results: ProbeResult[] = [];
  let done = 0;
  for (let i = 0; i < councils.length; i += concurrency) {
    const batch = councils.slice(i, i + concurrency);
    const batchRes = await Promise.all(batch.map((c) => probeCouncil(c, since)));
    results.push(...batchRes);
    done += batch.length;
    process.stdout.write(`\r  ${done}/${councils.length} probed...`);
  }
  process.stdout.write("\n");

  const fresh = results
    .filter((r) => r.recentFiles > 0)
    .sort((a, b) => b.recentFiles - a.recentFiles);
  const dead = results.filter((r) => r.recentFiles === 0 && !r.error);
  const errored = results.filter((r) => r.error);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  Fresh (recent files):  ${fresh.length}`);
  console.log(`  Stale (only old files): ${dead.length}`);
  console.log(`  Errored (dead feed):    ${errored.length}`);
  console.log(`${"=".repeat(64)}\n`);

  console.log("Fresh councils (scrapeable now):");
  for (const r of fresh) {
    console.log(
      `  ${r.slug.padEnd(34)} recent=${String(r.recentFiles).padStart(3)} ` +
        `total=${String(r.totalFiles).padStart(3)} newest=${r.newestSignal}`
    );
  }

  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { since, generatedAt: new Date().toISOString(), fresh, deadCount: dead.length, erroredCount: errored.length },
      null,
      2
    )
  );
  console.log(`\nWrote shortlist to ${OUT_PATH}`);
  console.log(`Slugs: ${fresh.map((f) => f.slug).join(",")}`);
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
