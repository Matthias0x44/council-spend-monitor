/**
 * For budget-ranked councils still missing transactions, find archived
 * spend CSVs via the Internet Archive CDX API and attach them as a
 * synthetic transparency source (direct file URLs stored in a JSON map).
 *
 * Then downloads+ingests those archived files into the local DB.
 *
 * Usage:
 *   npx tsx scripts/fill-from-wayback.ts
 *   npx tsx scripts/fill-from-wayback.ts --limit 80
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";
import { ingestFile } from "./lib/ingest";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const RAW_DIR = path.join(process.cwd(), "data", "raw");
const TOP_PATH = path.join(process.cwd(), "data", "top-100-councils.json");
const OUT = path.join(process.cwd(), "data", "wayback-fill.json");

function parseArgs(): { limit: number } {
  const argv = process.argv.slice(2);
  let limit = 120;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit" && argv[i + 1]) limit = parseInt(argv[++i], 10);
  }
  return { limit };
}

function domainGuess(slug: string, name: string): string[] {
  const bare = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bcouncil\b/g, "")
    .replace(/\bcity of\b/g, "")
    .replace(/\blondon borough of\b/g, "")
    .replace(/\broyal borough of\b/g, "")
    .replace(/\bmetropolitan (district|borough)\b/g, "")
    .replace(/\bborough\b/g, "")
    .replace(/\bcounty\b/g, "")
    .replace(/\bcity\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  const domains = new Set<string>();
  if (bare) {
    domains.add(`${bare}.gov.uk`);
    domains.add(`${bare}council.gov.uk`);
    domains.add(`www.${bare}.gov.uk`);
  }
  // Common short forms
  const map: Record<string, string[]> = {
    birmingham: ["birmingham.gov.uk"],
    manchester: ["manchester.gov.uk"],
    leeds: ["leeds.gov.uk"],
    sheffield: ["sheffield.gov.uk"],
    liverpool: ["liverpool.gov.uk"],
    bristol: ["bristol.gov.uk"],
    kent: ["kent.gov.uk"],
    surrey: ["surreycc.gov.uk"],
    essex: ["essex.gov.uk"],
    hampshire: ["hants.gov.uk"],
    hertfordshire: ["hertfordshire.gov.uk"],
    lancashire: ["lancashire.gov.uk"],
    norfolk: ["norfolk.gov.uk"],
    cornwall: ["cornwall.gov.uk"],
    devon: ["devon.gov.uk"],
    nottinghamshire: ["nottinghamshire.gov.uk"],
    derbyshire: ["derbyshire.gov.uk"],
    staffordshire: ["staffordshire.gov.uk"],
    oxfordshire: ["oxfordshire.gov.uk"],
    warwickshire: ["warwickshire.gov.uk"],
    worcestershire: ["worcestershire.gov.uk"],
    gloucestershire: ["gloucestershire.gov.uk"],
    durham: ["durham.gov.uk"],
    "west-sussex": ["westsussex.gov.uk"],
    "east-sussex": ["eastsussex.gov.uk"],
    lincolnshire: ["lincolnshire.gov.uk"],
    suffolk: ["suffolk.gov.uk"],
    leicestershire: ["leicestershire.gov.uk"],
    buckinghamshire: ["buckinghamshire.gov.uk"],
    cambridgeshire: ["cambridgeshire.gov.uk"],
    wiltshire: ["wiltshire.gov.uk"],
    somerset: ["somerset.gov.uk"],
    "north-yorkshire": ["northyorks.gov.uk"],
    croydon: ["croydon.gov.uk"],
    lambeth: ["lambeth.gov.uk"],
    southwark: ["southwark.gov.uk"],
    newham: ["newham.gov.uk"],
    hackney: ["hackney.gov.uk"],
    barnet: ["barnet.gov.uk"],
    ealing: ["ealing.gov.uk"],
    westminster: ["westminster.gov.uk"],
    islington: ["islington.gov.uk"],
    "tower-hamlets": ["towerhamlets.gov.uk"],
    lewisham: ["lewisham.gov.uk"],
    wandsworth: ["wandsworth.gov.uk"],
    haringey: ["haringey.gov.uk"],
    bradford: ["bradford.gov.uk"],
    newcastle: ["newcastle.gov.uk"],
    nottingham: ["nottinghamcity.gov.uk"],
    leicester: ["leicester.gov.uk"],
    coventry: ["coventry.gov.uk"],
    "milton-keynes": ["milton-keynes.gov.uk"],
    "cheshire-east": ["cheshireeast.gov.uk"],
    "cheshire-west-and-chester": ["cheshirewestandchester.gov.uk"],
    doncaster: ["doncaster.gov.uk"],
    gateshead: ["gateshead.gov.uk"],
    oldham: ["oldham.gov.uk"],
    bolton: ["bolton.gov.uk"],
    salford: ["salford.gov.uk"],
    calderdale: ["calderdale.gov.uk"],
    bury: ["bury.gov.uk"],
    tameside: ["tameside.gov.uk"],
    shropshire: ["shropshire.gov.uk"],
    dorset: ["dorsetcouncil.gov.uk"],
    northumberland: ["northumberland.gov.uk"],
    "east-riding-of-yorkshire": ["eastriding.gov.uk"],
    "stoke-on-trent": ["stoke.gov.uk"],
    wolverhampton: ["wolverhampton.gov.uk"],
    dudley: ["dudley.gov.uk"],
    sefton: ["sefton.gov.uk"],
    enfield: ["enfield.gov.uk"],
    "waltham-forest": ["walthamforest.gov.uk"],
    medway: ["medway.gov.uk"],
    "brighton-and-hove-city": ["brighton-hove.gov.uk"],
    "bournemouth-christchurch-and-poole": ["bcpcouncil.gov.uk"],
  };
  for (const d of map[slug] || []) domains.add(d);
  return [...domains];
}

async function cdxSearch(domain: string): Promise<string[]> {
  const queries = [
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*spend*&output=json&filter=mimetype:text/csv&fl=original,timestamp&collapse=urlkey&limit=40`,
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*expend*&output=json&filter=mimetype:text/csv&fl=original,timestamp&collapse=urlkey&limit=40`,
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*payment*&output=json&filter=mimetype:text/csv&fl=original,timestamp&collapse=urlkey&limit=40`,
  ];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    try {
      const res = await fetch(q, {
        headers: { "User-Agent": "CouncilSpendMonitor/1.0" },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as string[][];
      // first row is header
      for (const row of data.slice(1)) {
        const original = row[0];
        const ts = row[1];
        if (!original || !ts) continue;
        if (!/\.(csv|xlsx|xls)(\?|$)/i.test(original)) continue;
        if (!/spend|expend|payment|supplier|invoice|over.?500|over.?250/i.test(original)) {
          continue;
        }
        const wayback = `https://web.archive.org/web/${ts}id_/${original}`;
        if (seen.has(original)) continue;
        seen.add(original);
        urls.push(wayback);
      }
    } catch {
      /* ignore */
    }
  }
  return urls.slice(0, 24);
}

async function downloadWayback(
  url: string,
  destDir: string,
  filename: string
): Promise<string | null> {
  const dest = path.join(destDir, filename);
  if (fs.existsSync(dest)) {
    const head = fs.readFileSync(dest).slice(0, 80).toString("utf8").toLowerCase();
    if (!head.includes("<!doctype") && !head.includes("<html")) return dest;
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CouncilSpendMonitor/1.0" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.slice(0, 80).toString("utf8").toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html")) return null;
    if (buf.length < 200) return null;
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, buf);
    return dest;
  } catch {
    return null;
  }
}

async function main() {
  const { limit } = parseArgs();
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  const top = fs.existsSync(TOP_PATH)
    ? (JSON.parse(fs.readFileSync(TOP_PATH, "utf8")) as {
        councils: { slug: string; name: string; nreRank: number | null }[];
      })
    : { councils: [] };

  const missing = sqlite
    .prepare(
      `SELECT id, slug, name FROM councils c
       WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.council_id = c.id)
         AND name LIKE '%Council%'`
    )
    .all() as { id: number; slug: string; name: string }[];

  const bySlug = new Map(missing.map((m) => [m.slug, m]));
  const queue: typeof missing = [];
  for (const c of top.councils
    .filter((x) => x.nreRank != null)
    .sort((a, b) => (a.nreRank || 999) - (b.nreRank || 999))) {
    const m = bySlug.get(c.slug);
    if (m) queue.push(m);
  }
  for (const m of missing) {
    if (!queue.find((q) => q.slug === m.slug)) queue.push(m);
  }

  const targets = queue.slice(0, limit);
  console.log(`Wayback fill for up to ${targets.length} councils...`);

  const results: Array<Record<string, unknown>> = [];
  let gained = 0;

  for (const t of targets) {
    const current = (
      sqlite
        .prepare(`SELECT count(DISTINCT council_id) AS n FROM transactions`)
        .get() as { n: number }
    ).n;
    if (current >= 100) {
      console.log(`Reached ${current} councils — stopping.`);
      break;
    }

    process.stdout.write(`  ${t.slug}… `);
    const domains = domainGuess(t.slug, t.name);
    let urls: string[] = [];
    for (const d of domains) {
      urls = urls.concat(await cdxSearch(d));
      if (urls.length >= 8) break;
    }
    // dedupe
    urls = [...new Set(urls)].slice(0, 16);
    if (!urls.length) {
      console.log("no archives");
      results.push({ slug: t.slug, files: 0 });
      continue;
    }

    const rawDir = path.join(RAW_DIR, t.slug);
    let inserted = 0;
    let downloaded = 0;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const baseName =
        decodeURIComponent(url.split("/").pop()?.split("?")[0] || `file-${i}.csv`)
          .replace(/[^\w.\-]+/g, "-")
          .slice(0, 120);
      const dest = await downloadWayback(url, rawDir, baseName);
      if (!dest) continue;
      downloaded++;
      try {
        const r = ingestFile({
          councilId: t.id,
          councilSlug: t.slug,
          scrapeProfile: null,
          filePath: dest,
          fileUrl: url,
          db,
          sqlite,
        });
        inserted += r.inserted;
      } catch {
        /* skip bad file */
      }
    }

    if (inserted > 0) {
      sqlite
        .prepare(
          `UPDATE councils SET scrape_status='active', last_scraped_at=datetime('now') WHERE id=?`
        )
        .run(t.id);
      gained++;
      console.log(`downloaded=${downloaded} inserted=${inserted}`);
    } else {
      console.log(`downloaded=${downloaded} inserted=0`);
    }
    results.push({ slug: t.slug, downloaded, inserted, urls: urls.length });
  }

  const finalCount = (
    sqlite
      .prepare(`SELECT count(DISTINCT council_id) AS n FROM transactions`)
      .get() as { n: number }
  ).n;

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        gained,
        finalCount,
        results,
      },
      null,
      2
    )
  );
  console.log(`\nGained ${gained} councils. Library size: ${finalCount}`);
  console.log(`Wrote ${OUT}`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
