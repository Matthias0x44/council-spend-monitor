/**
 * For budget-ranked English LAs still missing transactions, search
 * data.gov.uk for a spend package whose resources still download as
 * real spreadsheets, then attach data_gov_id and activate the council.
 *
 * Usage:
 *   npx tsx scripts/attach-working-ckan.ts
 *   npx tsx scripts/attach-working-ckan.ts --limit 80
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const TOP_PATH = path.join(process.cwd(), "data", "top-100-councils.json");
const OUT = path.join(process.cwd(), "data", "ckan-attached.json");

const SKIP =
  /\b(nhs|ccg|pct|icb|trust|hospital|health|police|fire|park|department|ministry|agency|gallery|museum|archive|commission|partnership|foundation|british council)\b/i;

async function resourceIsGood(url: string): Promise<boolean> {
  try {
    const fr = await fetch(url, {
      headers: { "User-Agent": "CouncilSpendMonitor/1.0 (transparency research)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!fr.ok) return false;
    const buf = Buffer.from(await fr.arrayBuffer());
    if (buf.length < 300) return false;
    const head = buf.slice(0, 120).toString("utf8").toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html")) return false;
    return true;
  } catch {
    return false;
  }
}

async function packageHasGoodResources(packageId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://data.gov.uk/api/action/package_show?id=${encodeURIComponent(packageId)}`
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      result?: { resources?: { url: string; format?: string }[] };
    };
    const resources = (data.result?.resources || []).filter((r) =>
      ["csv", "xlsx", "xls"].includes((r.format || "").toLowerCase())
    );
    for (const r of resources.slice(0, 8)) {
      if (await resourceIsGood(r.url)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function searchSpendPackages(
  councilName: string,
  slug: string
): Promise<string[]> {
  const bare = councilName
    .replace(/ Council$/i, "")
    .replace(/^London Borough of /i, "")
    .replace(/^City of /i, "")
    .replace(/^Royal Borough of /i, "")
    .trim();
  const queries = [
    `"${bare}" "over 500"`,
    `"${bare}" "payments over"`,
    `"${bare}" spending supplier`,
  ];
  const ids: string[] = [];
  const seen = new Set<string>();
  const nameTokens = bare
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !["the", "and", "city", "upon"].includes(t));

  for (const q of queries) {
    const url = `https://data.gov.uk/api/action/package_search?q=${encodeURIComponent(q)}&rows=15`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        result?: {
          results?: {
            id: string;
            title: string;
            name?: string;
            organization?: { title?: string; name?: string };
          }[];
        };
      };
      for (const pkg of data.result?.results || []) {
        if (seen.has(pkg.id)) continue;
        const blob = `${pkg.title} ${pkg.name || ""} ${pkg.organization?.title || ""} ${pkg.organization?.name || ""}`.toLowerCase();
        if (!/spend|payment|expend|invoice|supplier|transparency|over.?500|over.?250/.test(blob)) {
          continue;
        }
        // Require the council's distinctive name tokens to appear in title/org
        // so we don't attach Plymouth's package to Kent, etc.
        const hits = nameTokens.filter((t) => blob.includes(t)).length;
        if (hits < Math.min(2, nameTokens.length) && !blob.includes(slug.replace(/-/g, " "))) {
          // Single-token names (e.g. "Kent") need an exact-ish hit
          if (!(nameTokens.length === 1 && blob.includes(nameTokens[0]))) continue;
          if (nameTokens.length > 1) continue;
        }
        seen.add(pkg.id);
        ids.push(pkg.id);
      }
    } catch {
      /* ignore */
    }
  }
  return ids;
}

function parseArgs(): { limit: number } {
  const argv = process.argv.slice(2);
  let limit = 120;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit" && argv[i + 1]) limit = parseInt(argv[++i], 10);
  }
  return { limit };
}

async function main() {
  const { limit } = parseArgs();
  const sqlite = new Database(DB_PATH);

  const top = fs.existsSync(TOP_PATH)
    ? (JSON.parse(fs.readFileSync(TOP_PATH, "utf8")) as {
        councils: { slug: string; name: string; nreRank: number | null }[];
      })
    : { councils: [] };

  // Prefer MHCLG-ranked shortlist, then any LA without txns.
  const rankedSlugs = top.councils
    .filter((c) => c.nreRank != null)
    .sort((a, b) => (a.nreRank || 999) - (b.nreRank || 999))
    .map((c) => c.slug);

  const missing = sqlite
    .prepare(
      `SELECT id, slug, name, data_gov_id AS dataGovId FROM councils c
       WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.council_id = c.id)
         AND name GLOB '*[Cc]ouncil*'
       ORDER BY name`
    )
    .all() as { id: number; slug: string; name: string; dataGovId: string | null }[];

  const bySlug = new Map(missing.map((m) => [m.slug, m]));
  const queue: typeof missing = [];
  for (const s of rankedSlugs) {
    const m = bySlug.get(s);
    if (m && !SKIP.test(m.name)) queue.push(m);
  }
  for (const m of missing) {
    if (SKIP.test(m.name)) continue;
    if (!queue.find((q) => q.slug === m.slug)) queue.push(m);
  }

  const targets = queue.slice(0, limit);
  console.log(`Searching CKAN for ${targets.length} councils missing transactions...`);

  const attached: Array<Record<string, unknown>> = [];
  const update = sqlite.prepare(
    `UPDATE councils SET data_gov_id = ?, scrape_status = 'active' WHERE id = ?`
  );

  for (const t of targets) {
    process.stdout.write(`  ${t.slug}… `);

    // Try existing id first
    if (t.dataGovId && (await packageHasGoodResources(t.dataGovId))) {
      update.run(t.dataGovId, t.id);
      console.log(`keep existing ${t.dataGovId.slice(0, 8)}`);
      attached.push({ slug: t.slug, packageId: t.dataGovId, source: "existing" });
      continue;
    }

    const candidates = await searchSpendPackages(t.name, t.slug);
    let found: string | null = null;
    for (const id of candidates.slice(0, 6)) {
      if (await packageHasGoodResources(id)) {
        found = id;
        break;
      }
    }

    if (found) {
      update.run(found, t.id);
      console.log(`attached ${found.slice(0, 8)}`);
      attached.push({ slug: t.slug, packageId: found, source: "search" });
    } else {
      console.log("none");
    }
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), attachedCount: attached.length, attached },
      null,
      2
    )
  );
  console.log(`\nAttached ${attached.length} working packages → ${OUT}`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
