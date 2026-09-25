/**
 * Rank English local authorities by MHCLG net revenue expenditure and
 * activate enough discoverable councils to reach a target library size
 * (default 100), keeping any councils that already have transactions.
 *
 * Usage:
 *   npx tsx scripts/select-top-councils.ts
 *   npx tsx scripts/select-top-councils.ts --fill-to 100 --activate-buffer 30
 *   npx tsx scripts/select-top-councils.ts --dry-run
 *
 * Writes data/top-100-councils.json and sets scrape_status='active' on
 * selected rows (unless --dry-run).
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { createReadStream } from "fs";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const OUT_PATH = path.join(process.cwd(), "data", "top-100-councils.json");
const MHCLG_DIR = path.join(process.cwd(), "data", "mhclg");
const MHCLG_CSV = path.join(MHCLG_DIR, "revenue_outturn_timeseries.csv");
const MHCLG_URL =
  "https://assets.publishing.service.gov.uk/media/6937fe05e447374889cd8f4b/Revenue_Outturn_time_series_data_v3.1.csv";

const ALLOWED_CLASSES = new Set([
  "Unitary Authority",
  "Met District",
  "London",
  "Shire County",
]);

const NRE_COLUMN = "RS_netrevexp_net_exp";

/** Non-LA / junk name patterns — never match these registry rows. */
const SKIP_NAME_RE =
  /\b(nhs|ccg|pct|icb|trust|hospital|health|police|fire|park|department|ministry|agency|gallery|museum|archive|commission|office of|homes england|transport for|partnership|foundation)\b/i;

/** Prefer registry rows that look like actual local authorities. */
const LA_NAME_RE =
  /\b(council|borough|county|city|unitary|metropolitan|london borough)\b/i;

/**
 * Curated transparency / open-data spend pages for large notables that
 * often lack a usable data.gov.uk package id in our registry.
 */
const TRANSPARENCY_URLS: Record<string, string> = {
  birmingham:
    "https://www.birmingham.gov.uk/info/20215/corporate_procurement_services/517/invoicing_the_council/5",
  manchester:
    "https://www.manchester.gov.uk/open-data/local-government-transparency-code",
  sheffield:
    "https://datamillnorth.org/dataset/council-spend-over-250-emd0m",
  liverpool:
    "https://liverpool.gov.uk/council/spending-and-performance/transparency-in-local-government/",
  bristol:
    "https://www.bristol.gov.uk/council/council-spending-and-performance/spending-over-500",
  kirklees:
    "https://www.kirklees.gov.uk/beta/information-and-data/expenditure-data.aspx",
  newcastle:
    "https://www.newcastle.gov.uk/local-government/transparency-and-open-data/payments-over-500",
  nottingham:
    "https://www.nottinghamcity.gov.uk/your-council/about-the-council/transparency-open-data/",
  leicester:
    "https://www.leicester.gov.uk/your-council/how-we-work/transparency-and-open-data/",
  coventry:
    "https://www.coventry.gov.uk/downloads/download/557/expenditure_exceeding_500",
  westminster:
    "https://www.westminster.gov.uk/payments-over-500",
  camden: "https://opendata.camden.gov.uk/browse?category=Finance",
  "tower-hamlets":
    "https://www.towerhamlets.gov.uk/lgnl/council_and_democracy/Transparency/Council_payments_over_500.aspx",
  hackney: "https://hackney.gov.uk/payments-to-suppliers",
  islington: "https://www.islington.gov.uk/about-the-council/transparency",
  lambeth: "https://www.lambeth.gov.uk/better-fairer-lambeth/transparency",
  southwark: "https://www.southwark.gov.uk/council-and-democracy/transparency",
  newham: "https://www.newham.gov.uk/council/council-spending-finance",
  barnet: "https://www.barnet.gov.uk/your-council/transparency",
  croydon: "https://www.croydon.gov.uk/council-and-elections/budgets-and-spending",
  ealing: "https://www.ealing.gov.uk/info/201047/council_spending",
  haringey: "https://www.haringey.gov.uk/local-democracy/transparency",
  hounslow: "https://www.hounslow.gov.uk/info/20110/open_data_and_transparency",
  greenwich: "https://www.royalgreenwich.gov.uk/info/200210/transparency",
  lewisham: "https://lewisham.gov.uk/mayorandcouncil/aboutthecouncil/finances",
  wandsworth: "https://www.wandsworth.gov.uk/about-the-council/transparency/",
  kent: "https://www.kent.gov.uk/about-the-council/finance-and-budget/spending",
  hampshire:
    "https://www.hants.gov.uk/aboutthecouncil/strategiesplansandpolicies/transparency",
  surrey: "https://www.surreycc.gov.uk/council-and-democracy/finance-and-accounts",
  essex: "https://www.essex.gov.uk/spending-and-performance",
  lancashire:
    "https://www.lancashire.gov.uk/council/performance-spending-and-reviews/spending/",
  devon: "https://www.devon.gov.uk/open-data/",
  norfolk: "https://www.norfolk.gov.uk/what-we-do-and-how-we-work/open-data",
  suffolk: "https://www.suffolk.gov.uk/council-and-democracy/council-budgets-and-spending",
  hertfordshire: "https://www.hertfordshire.gov.uk/about-the-council/freedom-of-information-and-council-data",
  bradford: "https://www.bradford.gov.uk/your-council/council-budgets-and-spending/",
  calderdale: "https://www.calderdale.gov.uk/v2/council/transparency",
  wakefield: "https://www.wakefield.gov.uk/about-the-council/transparency/",
  bolton: "https://www.bolton.gov.uk/transparency",
  tameside: "https://www.tameside.gov.uk/transparency",
  oldham: "https://www.oldham.gov.uk/info/200144/transparency",
  trafford: "https://www.trafford.gov.uk/about-your-council/budgets-and-transparency",
  salford: "https://www.salford.gov.uk/your-council/council-and-decision-making/transparency/",
  bury: "https://www.bury.gov.uk/council-and-democracy/transparency",
  sunderland: "https://www.sunderland.gov.uk/article/12786/Payments-to-suppliers",
  gateshead: "https://www.gateshead.gov.uk/article/2940/Transparency",
  cornwall: "https://www.cornwall.gov.uk/council-and-democracy/transparency/",
  plymouth: "https://www.plymouth.gov.uk/transparency-and-open-data",
  "milton-keynes": "https://www.milton-keynes.gov.uk/your-council-and-elections/council-information-and-meetings/transparency",
  "west-sussex": "https://www.westsussex.gov.uk/about-the-council/strategies-plans-and-policies/transparency/",
  nottinghamshire: "https://www.nottinghamshire.gov.uk/council/transparency",
  derbyshire: "https://www.derbyshire.gov.uk/council/council-spending/council-spending.aspx",
  staffordshire: "https://www.staffordshire.gov.uk/Your-council/Open-data/Payments-to-suppliers.aspx",
  oxfordshire: "https://www.oxfordshire.gov.uk/council/about-your-council/transparency",
  somerset: "https://www.somerset.gov.uk/council-and-democracy/transparency/",
  durham: "https://www.durham.gov.uk/transparency",
  leicestershire: "https://www.leicestershire.gov.uk/about-the-council/council-spending",
  warwickshire: "https://www.warwickshire.gov.uk/transparency",
  worcestershire: "https://www.worcestershire.gov.uk/council/transparency",
  gloucestershire: "https://www.gloucestershire.gov.uk/council-and-democracy/transparency/",
  dorset: "https://www.dorsetcouncil.gov.uk/your-council/transparency",
  northumberland: "https://www.northumberland.gov.uk/About/Transparency.aspx",
  "cheshire-east": "https://www.cheshireeast.gov.uk/council_and_democracy/transparency.aspx",
  "east-riding-of-yorkshire": "https://www.eastriding.gov.uk/council/governance-and-spending/",
  "brighton-and-hove": "https://www.brighton-hove.gov.uk/council-and-democracy/transparency",
  "stoke-on-trent": "https://www.stoke.gov.uk/info/20006/finance_and_council_tax",
  "kingston-upon-hull": "https://www.hull.gov.uk/council-and-democracy/transparency",
  hull: "https://www.hull.gov.uk/council-and-democracy/transparency",
  medway: "https://www.medway.gov.uk/info/200170/transparency",
  shropshire: "https://www.shropshire.gov.uk/transparency/",
  "central-bedfordshire": "https://www.centralbedfordshire.gov.uk/info/45/council_and_democracy/472/transparency",
  "west-northamptonshire": "https://www.westnorthants.gov.uk/council/transparency",
  "north-northamptonshire": "https://www.northnorthants.gov.uk/council/transparency",
  "bournemouth-christchurch-and-poole": "https://www.bcpcouncil.gov.uk/About-the-council/Transparency/Payments-to-suppliers.aspx",
  doncaster: "https://www.doncaster.gov.uk/services/the-council-democracy/transparency",
  sefton: "https://www.sefton.gov.uk/your-council/transparency/",
  brent: "https://www.brent.gov.uk/your-council/transparency",
  enfield: "https://www.enfield.gov.uk/services/your-council/transparency",
  "waltham-forest": "https://www.walthamforest.gov.uk/council-and-elections/budgets-and-spending",
  bromley: "https://www.bromley.gov.uk/council/transparency",
  "london-bromley": "https://www.bromley.gov.uk/council/transparency",
  hillingdon: "https://www.hillingdon.gov.uk/transparency",
  "london-hillingdon": "https://www.hillingdon.gov.uk/transparency",
  redbridge: "https://www.redbridge.gov.uk/about-the-council/transparency/",
  "london-redbridge": "https://www.redbridge.gov.uk/about-the-council/transparency/",
  havering: "https://www.havering.gov.uk/info/20044/transparency",
  wolverhampton: "https://www.wolverhampton.gov.uk/your-council/transparency",
  dudley: "https://www.dudley.gov.uk/council-community/transparency/",
  "westmorland-and-furness": "https://www.westmorlandandfurness.gov.uk/your-council/transparency",
};

/** Prefer these registry slugs when MHCLG names collide with duplicates. */
const SLUG_ALIASES: Record<string, string> = {
  leeds: "leeds",
  bristol: "bristol",
  manchester: "manchester",
  birmingham: "birmingham",
  liverpool: "liverpool",
  sheffield: "sheffield",
  rochdale: "rochdale-borough",
  york: "york",
  hounslow: "london-hounslow",
  camden: "london-camden",
  bromley: "london-bromley",
  hillingdon: "london-hillingdon",
  redbridge: "london-redbridge",
  sutton: "london-sutton",
  "richmond-upon-thames": "london-richmond-upon-thames",
  greenwich: "royal-greenwich",
  "brighton-hove": "brighton-and-hove-city",
  "brighton-and-hove": "brighton-and-hove-city",
  "kingston-upon-hull": "hull-city",
  hull: "hull-city",
  plymouth: "plymouth-city",
  derby: "derby-city",
  "north-yorkshire": "north-yorkshire",
  buckinghamshire: "buckinghamshire",
  "cheshire-west-and-chester": "cheshire-west-and-chester",
};

interface Args {
  fillTo: number;
  activateBuffer: number;
  dryRun: boolean;
}

interface MhclgLa {
  onsCode: string;
  name: string;
  laClass: string;
  yearEnding: number;
  nre: number; // £000s as published
}

interface CouncilRow {
  id: number;
  name: string;
  slug: string;
  region: string | null;
  data_gov_id: string | null;
  transparency_url: string | null;
  scrape_status: string | null;
}

interface SelectedCouncil {
  slug: string;
  name: string;
  nreRank: number | null;
  nreAmountGbp: number | null;
  laClass: string | null;
  yearEnding: number | null;
  discovery: "ckan" | "url" | "none";
  alreadyIngested: boolean;
  activated: boolean;
  inserted: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let fillTo = 100;
  let activateBuffer = 30;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fill-to" && argv[i + 1]) fillTo = parseInt(argv[++i], 10);
    if (argv[i] === "--activate-buffer" && argv[i + 1])
      activateBuffer = parseInt(argv[++i], 10);
    if (argv[i] === "--dry-run") dryRun = true;
  }
  return { fillTo, activateBuffer, dryRun };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bcouncil\b/gi, "")
    .replace(/\bcity of\b/gi, "")
    .replace(/\bborough of\b/gi, "")
    .replace(/\broyal borough of\b/gi, "")
    .replace(/\blondon borough of\b/gi, "")
    .replace(/\bmetropolitan borough\b/gi, "")
    .replace(/\bmetropolitan district\b/gi, "")
    .replace(/\bdistrict\b/gi, "")
    .replace(/\bcounty\b/gi, "")
    .replace(/\b\s*ua\b/gi, "")
    .replace(/\b\s*cc\b/gi, "")
    .replace(/\b\s*mbc\b/gi, "")
    .replace(/\btowns\b/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayName(mhclgName: string, laClass: string): string {
  const n = mhclgName
    .replace(/\s+UA$/i, "")
    .replace(/\s+CC$/i, "")
    .replace(/\s+MBC$/i, "")
    .trim();
  if (laClass === "Shire County" && !/county/i.test(n)) {
    return `${n} County Council`;
  }
  if (laClass === "London" && !/london borough|city of london|westminster/i.test(n)) {
    return `London Borough of ${n}`;
  }
  if (!/council$/i.test(n) && laClass !== "London") {
    return `${n} Council`;
  }
  return n;
}

function regionFor(laClass: string): string {
  if (laClass === "London") return "London";
  if (laClass === "Shire County") return "England";
  if (laClass === "Met District") return "England";
  return "England";
}

async function ensureMhclgCsv(): Promise<void> {
  if (fs.existsSync(MHCLG_CSV) && fs.statSync(MHCLG_CSV).size > 1_000_000) {
    console.log(`Using cached MHCLG CSV: ${MHCLG_CSV}`);
    return;
  }
  fs.mkdirSync(MHCLG_DIR, { recursive: true });
  console.log("Downloading MHCLG Revenue Outturn time series...");
  const res = await fetch(MHCLG_URL);
  if (!res.ok) throw new Error(`MHCLG download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(MHCLG_CSV, buf);
  console.log(`  Wrote ${(buf.length / 1e6).toFixed(1)} MB`);
}

async function loadMhclgRanking(): Promise<MhclgLa[]> {
  await ensureMhclgCsv();

  const best = new Map<string, MhclgLa>();
  const rl = readline.createInterface({
    input: createReadStream(MHCLG_CSV),
    crlfDelay: Infinity,
  });

  let headers: string[] | null = null;
  for await (const line of rl) {
    const cols = parseCsvLine(line);
    if (!headers) {
      headers = cols.map((h) => h.replace(/^"|"$/g, ""));
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] || "").replace(/^"|"$/g, "");
    });

    if (row.status !== "submitted") continue;
    if (!ALLOWED_CLASSES.has(row.LA_class)) continue;
    const nre = Number(row[NRE_COLUMN]);
    if (!Number.isFinite(nre) || nre <= 0) continue;
    const yearEnding = Number(row.year_ending);
    const ons = row.ONS_code;
    if (!ons || ons.length < 5) continue; // skip aggregate totals like E06

    const prev = best.get(ons);
    if (!prev || yearEnding > prev.yearEnding) {
      best.set(ons, {
        onsCode: ons,
        name: row.LA_name,
        laClass: row.LA_class,
        yearEnding,
        nre,
      });
    }
  }

  return [...best.values()].sort((a, b) => b.nre - a.nre);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function discoveryOf(c: {
  data_gov_id: string | null;
  transparency_url: string | null;
}): "ckan" | "url" | "none" {
  if (c.data_gov_id) return "ckan";
  if (c.transparency_url) return "url";
  return "none";
}

function pickBestCandidate(
  cands: CouncilRow[],
  preferredSlug?: string
): CouncilRow | null {
  const usable = cands.filter(
    (c) => !SKIP_NAME_RE.test(c.name) && LA_NAME_RE.test(c.name)
  );
  if (usable.length === 0) return null;
  if (preferredSlug) {
    const pref = usable.find((c) => c.slug === preferredSlug);
    if (pref) return pref;
  }
  // Prefer rows with discovery sources, then raw cache, then shortest slug.
  const rawDir = path.join(process.cwd(), "data", "raw");
  usable.sort((a, b) => {
    const score = (c: CouncilRow) => {
      let s = 0;
      if (c.data_gov_id) s += 4;
      if (c.transparency_url) s += 3;
      if (fs.existsSync(path.join(rawDir, c.slug))) s += 2;
      if (c.scrape_status === "active") s += 1;
      return s;
    };
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return a.slug.length - b.slug.length;
  });
  return usable[0];
}

function findMatch(
  la: MhclgLa,
  bySlug: Map<string, CouncilRow[]>,
  byNorm: Map<string, CouncilRow[]>
): CouncilRow | null {
  const base = slugify(la.name);
  const alias = SLUG_ALIASES[base];
  // Only allow exact / known-variant slugs — never prefix matches like
  // "derbyshire" → "derbyshire-dales" (different authority).
  const variants = [
    alias,
    base,
    `london-${base}`,
    `${base}-city`,
    `${base}-borough`,
    `${base}-metropolitan`,
  ].filter(Boolean) as string[];

  for (const v of variants) {
    const hit = pickBestCandidate(bySlug.get(v) || byNorm.get(v) || [], alias);
    if (hit) return hit;
  }
  return null;
}

function mainSyncSetup(sqlite: Database.Database) {
  // Ensure discovery columns exist
  const migrations = [
    "ALTER TABLE councils ADD COLUMN transparency_url TEXT",
    "ALTER TABLE councils ADD COLUMN data_gov_id TEXT",
    "ALTER TABLE councils ADD COLUMN scrape_status TEXT DEFAULT 'pending'",
  ];
  for (const m of migrations) {
    try {
      sqlite.exec(m);
    } catch {
      /* exists */
    }
  }
}

async function main() {
  const { fillTo, activateBuffer, dryRun } = parseArgs();
  console.log(
    `Target library size: ${fillTo} (activate buffer +${activateBuffer})${
      dryRun ? " [dry-run]" : ""
    }`
  );

  const ranking = await loadMhclgRanking();
  console.log(`MHCLG ranked LAs: ${ranking.length}`);
  console.log("Top 10 by NRE:");
  ranking.slice(0, 10).forEach((la, i) => {
    console.log(
      `  ${String(i + 1).padStart(3)}. £${(la.nre / 1000).toFixed(0)}m  ${la.name} (${la.yearEnding})`
    );
  });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  mainSyncSetup(sqlite);

  const councils = sqlite
    .prepare(
      `SELECT id, name, slug, region, data_gov_id, transparency_url, scrape_status
       FROM councils`
    )
    .all() as CouncilRow[];

  const bySlug = new Map<string, CouncilRow[]>();
  const byNorm = new Map<string, CouncilRow[]>();
  for (const c of councils) {
    if (!bySlug.has(c.slug)) bySlug.set(c.slug, []);
    bySlug.get(c.slug)!.push(c);
    const n = slugify(c.name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n)!.push(c);
    if (!byNorm.has(c.slug)) byNorm.set(c.slug, []);
    byNorm.get(c.slug)!.push(c);
  }

  const ingestedIds = new Set(
    (
      sqlite
        .prepare(`SELECT DISTINCT council_id AS id FROM transactions`)
        .all() as { id: number }[]
    ).map((r) => r.id)
  );
  console.log(`Already ingested: ${ingestedIds.size}`);

  const insertStmt = sqlite.prepare(
    `INSERT INTO councils (name, slug, region, transparency_url, scrape_status)
     VALUES (?, ?, ?, ?, 'pending')`
  );
  const updateUrlStmt = sqlite.prepare(
    `UPDATE councils SET transparency_url = ? WHERE id = ?`
  );
  const activateStmt = sqlite.prepare(
    `UPDATE councils SET scrape_status = 'active' WHERE id = ?`
  );

  const selected: SelectedCouncil[] = [];
  const selectedIds = new Set<number>();

  // 1) Always keep already-ingested councils
  for (const c of councils) {
    if (!ingestedIds.has(c.id)) continue;
    selectedIds.add(c.id);
    // Fill discovery if we have a curated URL
    const url = TRANSPARENCY_URLS[c.slug];
    if (url && !c.transparency_url && !dryRun) {
      updateUrlStmt.run(url, c.id);
      c.transparency_url = url;
    }
    selected.push({
      slug: c.slug,
      name: c.name,
      nreRank: null,
      nreAmountGbp: null,
      laClass: null,
      yearEnding: null,
      discovery: discoveryOf(c),
      alreadyIngested: true,
      activated: c.scrape_status === "active",
      inserted: false,
    });
  }

  // 2) Walk MHCLG ranking; match or insert; fill discovery; collect until
  //    we have fillTo + buffer discoverable actives (counting already ingested).
  let rank = 0;
  for (const la of ranking) {
    rank++;
    let match = findMatch(la, bySlug, byNorm);
    let inserted = false;

    if (!match) {
      const slug = SLUG_ALIASES[slugify(la.name)] || slugify(la.name);
      if (bySlug.has(slug)) {
        match = pickBestCandidate(bySlug.get(slug)!, slug);
      }
      if (!match) {
        const name = displayName(la.name, la.laClass);
        const url = TRANSPARENCY_URLS[slug] || null;
        if (dryRun) {
          match = {
            id: -rank,
            name,
            slug,
            region: regionFor(la.laClass),
            data_gov_id: null,
            transparency_url: url,
            scrape_status: "pending",
          };
        } else {
          const info = insertStmt.run(
            name,
            slug,
            regionFor(la.laClass),
            url
          );
          match = {
            id: Number(info.lastInsertRowid),
            name,
            slug,
            region: regionFor(la.laClass),
            data_gov_id: null,
            transparency_url: url,
            scrape_status: "pending",
          };
          bySlug.set(slug, [match]);
        }
        inserted = true;
      }
    }

    if (!match || selectedIds.has(match.id)) {
      // Annotate already-selected with NRE if we can
      if (match && selectedIds.has(match.id)) {
        const row = selected.find((s) => s.slug === match!.slug);
        if (row && row.nreRank == null) {
          row.nreRank = rank;
          row.nreAmountGbp = Math.round(la.nre * 1000);
          row.laClass = la.laClass;
          row.yearEnding = la.yearEnding;
        }
      }
      continue;
    }

    // Fill transparency URL from curated map / aliases
    const curated =
      TRANSPARENCY_URLS[match.slug] ||
      TRANSPARENCY_URLS[slugify(la.name)] ||
      null;
    if (curated) {
      if (!dryRun) updateUrlStmt.run(curated, match.id);
      match.transparency_url = curated;
    }

    const disc = discoveryOf(match);
    selectedIds.add(match.id);
    selected.push({
      slug: match.slug,
      name: match.name,
      nreRank: rank,
      nreAmountGbp: Math.round(la.nre * 1000),
      laClass: la.laClass,
      yearEnding: la.yearEnding,
      discovery: disc,
      alreadyIngested: ingestedIds.has(match.id),
      activated: false,
      inserted,
    });

    const discoverable = selected.filter((s) => s.discovery !== "none").length;
    if (discoverable >= fillTo + activateBuffer) break;
  }

  // Prefer discoverable rows when deciding whom to activate beyond the
  // already-ingested set. Keep all already-ingested; then take ranked
  // discoverables until fillTo; extras up to buffer also activated.
  const already = selected.filter((s) => s.alreadyIngested);
  const newcomers = selected
    .filter((s) => !s.alreadyIngested)
    .sort((a, b) => {
      const da = a.discovery === "none" ? 1 : 0;
      const db = b.discovery === "none" ? 1 : 0;
      if (da !== db) return da - db;
      return (a.nreRank || 9999) - (b.nreRank || 9999);
    });

  const need = Math.max(0, fillTo - already.length);
  const activateLimit = need + activateBuffer;
  const toActivate = [
    ...already,
    ...newcomers.filter((s) => s.discovery !== "none").slice(0, activateLimit),
  ];

  // If still short on discoverables, include next ranked with discovery:none
  // only so the JSON records the gap — do not activate them.
  const activateSlugs = new Set(toActivate.map((s) => s.slug));

  let activated = 0;
  for (const s of toActivate) {
    if (!dryRun) {
      const row = sqlite
        .prepare(`SELECT id FROM councils WHERE slug = ?`)
        .get(s.slug) as { id: number } | undefined;
      if (row) {
        activateStmt.run(row.id);
        activated++;
        s.activated = true;
      }
    } else {
      s.activated = true;
      activated++;
    }
  }

  // Final shortlist for the JSON: already ingested + activated newcomers,
  // capped conceptually at fillTo for the "library" view but including
  // the buffer so pipeline has spare capacity.
  const shortlist = selected
    .filter((s) => activateSlugs.has(s.slug) || s.alreadyIngested)
    .sort((a, b) => {
      if (a.alreadyIngested !== b.alreadyIngested)
        return a.alreadyIngested ? -1 : 1;
      return (a.nreRank || 9999) - (b.nreRank || 9999);
    });

  const deferred = selected.filter(
    (s) => !activateSlugs.has(s.slug) && s.discovery === "none"
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    fillTo,
    activateBuffer,
    dryRun,
    mhclgSource: MHCLG_URL,
    nreColumn: NRE_COLUMN,
    alreadyIngested: already.length,
    selectedCount: shortlist.length,
    discoverableSelected: shortlist.filter((s) => s.discovery !== "none")
      .length,
    activated,
    deferredCount: deferred.length,
    councils: shortlist,
    deferred: deferred.slice(0, 40),
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(
    `Selected ${shortlist.length} (discoverable ${payload.discoverableSelected}), activated ${activated}, already ingested ${already.length}`
  );
  console.log(
    `Discovery mix: ckan=${shortlist.filter((s) => s.discovery === "ckan").length} url=${shortlist.filter((s) => s.discovery === "url").length} none=${shortlist.filter((s) => s.discovery === "none").length}`
  );

  if (!dryRun) {
    const active = sqlite
      .prepare(`SELECT count(*) AS n FROM councils WHERE scrape_status='active'`)
      .get() as { n: number };
    console.log(`DB scrape_status=active: ${active.n}`);
  }

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
