/**
 * Bulk-find working "payments over £500" packages on data.gov.uk and
 * attach them to matching LA councils.
 *
 * Usage: npx tsx scripts/attach-working-ckan-bulk.ts
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const OUT = path.join(process.cwd(), "data", "ckan-bulk-attached.json");

const SKIP =
  /\b(nhs|ccg|pct|icb|trust|hospital|health|police|fire|park|department|ministry|agency|gallery|museum|archive|commission|partnership|foundation)\b/i;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bcouncil\b/g, "")
    .replace(/\bcity of\b/g, "")
    .replace(/\blondon borough of\b/g, "london-")
    .replace(/\broyal borough of\b/g, "")
    .replace(/\bmetropolitan (district|borough)\b/g, "")
    .replace(/\bborough\b/g, "")
    .replace(/\bcounty\b/g, "")
    .replace(/\bcity\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resourceGood(url: string): Promise<boolean> {
  try {
    const fr = await fetch(url, {
      headers: { "User-Agent": "CouncilSpendMonitor/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!fr.ok) return false;
    const buf = Buffer.from(await fr.arrayBuffer());
    if (buf.length < 400) return false;
    const head = buf.slice(0, 100).toString("utf8").toLowerCase();
    return !head.includes("<!doctype") && !head.includes("<html");
  } catch {
    return false;
  }
}

async function packageGood(id: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://data.gov.uk/api/action/package_show?id=${encodeURIComponent(id)}`
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      result?: { resources?: { url: string; format?: string; name?: string }[] };
    };
    const resources = (data.result?.resources || []).filter((r) => {
      const fmt = (r.format || "").toLowerCase();
      const name = `${r.name || ""} ${r.url || ""}`;
      return (
        ["csv", "xlsx", "xls"].includes(fmt) ||
        /\.(csv|xlsx|xls)(\?|#|$)/i.test(name)
      );
    });
    for (const r of resources.slice(0, 5)) {
      if (await resourceGood(r.url)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function main() {
  const queries = [
    "payments over 500",
    "spend over 500",
    "expenditure over 500",
    "council spending transparency",
  ];
  const packages = new Map<
    string,
    { id: string; title: string; org: string }
  >();

  for (const q of queries) {
    for (let start = 0; start < 200; start += 50) {
      const url = `https://data.gov.uk/api/action/package_search?q=${encodeURIComponent(q)}&rows=50&start=${start}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const data = (await res.json()) as {
        result?: {
          count: number;
          results?: {
            id: string;
            title: string;
            organization?: { title?: string };
          }[];
        };
      };
      const results = data.result?.results || [];
      if (!results.length) break;
      for (const p of results) {
        if (packages.has(p.id)) continue;
        const org = p.organization?.title || "";
        if (!org || SKIP.test(org) || SKIP.test(p.title)) continue;
        if (!/council|borough|county|city|unitary|authority/i.test(org)) continue;
        packages.set(p.id, { id: p.id, title: p.title, org });
      }
      if (start + 50 >= (data.result?.count || 0)) break;
    }
  }

  console.log(`Unique LA-ish packages to probe: ${packages.size}`);
  const sqlite = new Database(DB_PATH);
  const attached: Array<Record<string, unknown>> = [];

  let i = 0;
  for (const pkg of packages.values()) {
    i++;
    process.stdout.write(`[${i}/${packages.size}] ${pkg.org.slice(0, 40)}… `);
    const ok = await packageGood(pkg.id);
    if (!ok) {
      console.log("dead");
      continue;
    }

    const variants = [
      slugify(pkg.org),
      slugify(pkg.org) + "-city",
      slugify(pkg.org) + "-borough",
      "london-" + slugify(pkg.org.replace(/^London Borough of /i, "")),
    ];
    let match: { id: number; slug: string } | undefined;
    for (const v of variants) {
      match = sqlite
        .prepare(
          `SELECT id, slug FROM councils
           WHERE slug = ? AND name NOT LIKE '%NHS%' AND name NOT LIKE '%Trust%'
           LIMIT 1`
        )
        .get(v) as { id: number; slug: string } | undefined;
      if (match) break;
    }
    if (!match) {
      // insert new council
      const slug = variants[0];
      const info = sqlite
        .prepare(
          `INSERT INTO councils (name, slug, region, data_gov_id, scrape_status)
           VALUES (?, ?, 'England', ?, 'active')`
        )
        .run(pkg.org, slug, pkg.id);
      match = { id: Number(info.lastInsertRowid), slug };
      console.log(`inserted+attached ${slug}`);
    } else {
      const hasTxn = sqlite
        .prepare(`SELECT 1 FROM transactions WHERE council_id = ? LIMIT 1`)
        .get(match.id);
      if (hasTxn) {
        console.log(`skip (already has txns) ${match.slug}`);
        continue;
      }
      sqlite
        .prepare(
          `UPDATE councils SET data_gov_id = ?, scrape_status = 'active' WHERE id = ?`
        )
        .run(pkg.id, match.id);
      console.log(`attached ${match.slug}`);
    }
    attached.push({ ...pkg, slug: match.slug });
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), attachedCount: attached.length, attached },
      null,
      2
    )
  );
  console.log(`\nAttached ${attached.length} → ${OUT}`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
