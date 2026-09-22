/**
 * Discover live spend datasets on DataMill North and attach them to
 * matching councils in the registry (data_gov_id = "datamill:<id>").
 *
 * Usage: npx tsx scripts/attach-datamill.ts
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const OUT = path.join(process.cwd(), "data", "datamill-attached.json");

function slugifyOrg(title: string): string[] {
  const base = title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bcouncil\b/g, "")
    .replace(/\bcity of\b/g, "")
    .replace(/\bmetropolitan (district|borough)\b/g, "")
    .replace(/\bborough\b/g, "")
    .replace(/\bcity\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return [
    base,
    `${base}-city`,
    `${base}-borough`,
    `${base}-metropolitan`,
    `london-${base}`,
  ];
}

async function main() {
  const res = await fetch(
    "https://datamillnorth.org/api/3/action/package_search?q=spend&rows=200",
    { headers: { "User-Agent": "CouncilSpendMonitor/1.0" } }
  );
  const data = (await res.json()) as {
    result: { result: Array<{
      id: string;
      title: string;
      num_resources: number;
      organization?: { title?: string };
      resources?: { name?: string; url?: string; format?: string }[];
    }> };
  };

  const datasets = (data.result.result || []).filter((p) => {
    const t = (p.title || "").toLowerCase();
    return /spend|payment|expend|supplier|invoice/.test(t) &&
      !/performance|pipeline|grant|parking|benefit|pothole|agency|3rd sector|third sector|summar/.test(t);
  });

  console.log(`Candidate DataMill spend datasets: ${datasets.length}`);

  const sqlite = new Database(DB_PATH);
  const attached: Array<Record<string, unknown>> = [];

  for (const ds of datasets) {
    const org = ds.organization?.title || "";
    if (!org) continue;
    // Prefer datasets with spreadsheet-like resources
    const resources = ds.resources || [];
    const sheetCount = resources.filter((r) =>
      /\.(csv|xlsx|xls)(\?|#|$)/i.test(`${r.name || ""} ${r.url || ""}`) ||
      ["csv", "xlsx", "xls"].includes((r.format || "").toLowerCase())
    ).length;
    if (sheetCount < 1 && ds.num_resources < 1) continue;

    const variants = slugifyOrg(org);
    let matched: { id: number; slug: string; name: string } | undefined;
    for (const v of variants) {
      const row = sqlite
        .prepare(
          `SELECT id, slug, name FROM councils
           WHERE slug = ?
             AND name NOT LIKE '%NHS%'
             AND name NOT LIKE '%Trust%'
             AND name NOT LIKE '%PCT%'
           LIMIT 1`
        )
        .get(v) as { id: number; slug: string; name: string } | undefined;
      if (row) {
        matched = row;
        break;
      }
    }
    if (!matched) {
      // fuzzy by org title tokens
      const token = org.split(/\s+/)[0];
      if (token.length > 3) {
        matched = sqlite
          .prepare(
            `SELECT id, slug, name FROM councils
             WHERE name LIKE ?
               AND name LIKE '%Council%'
               AND name NOT LIKE '%NHS%'
               AND name NOT LIKE '%Trust%'
             ORDER BY length(slug) ASC LIMIT 1`
          )
          .get(`${token}%`) as { id: number; slug: string; name: string } | undefined;
      }
    }
    if (!matched) {
      console.log(`  no match for ${org} (${ds.title})`);
      continue;
    }

    // Don't overwrite an already-ingested council's working source, or a
    // non-datamill id that already produced transactions.
    const hasTxn = sqlite
      .prepare(`SELECT 1 FROM transactions WHERE council_id = ? LIMIT 1`)
      .get(matched.id);
    if (hasTxn) continue;

    const datamillId = `datamill:${ds.id}`;
    sqlite
      .prepare(
        `UPDATE councils SET data_gov_id = ?, scrape_status = 'active' WHERE id = ?`
      )
      .run(datamillId, matched.id);
    console.log(`  ${matched.slug} ← ${datamillId} (${ds.title.slice(0, 50)})`);
    attached.push({
      slug: matched.slug,
      packageId: datamillId,
      title: ds.title,
      org,
      sheetCount,
    });
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
