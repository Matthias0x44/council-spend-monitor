/**
 * Attach direct OpenDataSoft / CKAN export URLs for councils that fail HTML discovery.
 * Usage: npx tsx scripts/attach-direct-exports.ts
 */
import Database from "better-sqlite3";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");

/** Direct spreadsheet/export URLs or ODS explore pages that expose CSV. */
const DIRECT: Record<string, { url?: string; dataGovId?: string }> = {
  leicester: {
    url: "https://data.leicester.gov.uk/api/explore/v2.1/catalog/datasets/expenditure-exceeding-ps500-2022/exports/csv",
  },
  birmingham: {
    url: "https://www.cityobservatory.birmingham.gov.uk/api/explore/v2.1/catalog/datasets/payments-to-suppliers-over-500/exports/csv",
  },
  calderdale: {
    // DataWorks CKAN-style
    dataGovId: "ckan:dataworks.calderdale.gov.uk/2wqx8",
  },
  brent: {
    url: "https://data.brent.gov.uk/download/vq756/what-we-spend.csv",
  },
  hounslow: {
    dataGovId: "ckan:data.hounslow.gov.uk/council-spending-over-f500",
  },
  surrey: {
    dataGovId: "ckan:www.surreyi.gov.uk/e6rgn",
  },
  // Districts / unitaries with known CKAN packages on data.gov.uk that previously worked
  "tunbridge-wells-borough": {
    dataGovId: "ba746270-485e-4c39-88dc-53ceb0e5df2f",
  },
  sandwell: {
    dataGovId: "c72d7b5c-196c-45e0-9ddd-c1998395de76",
  },
  trafford: {
    dataGovId: "e32c1ade-5608-4952-b36c-58e5b73eba2a",
  },
  wirral: {
    dataGovId: "cd60f6d6-56bd-4511-90d0-31e012430f6c",
  },
  plymouth: {
    dataGovId: "9e9b0128-9095-4bde-b24b-d04e60789016",
  },
  wigan: {
    dataGovId: "546a96e6-4f09-4998-9df0-52363f240355",
  },
  leeds: {
    // Prefer DataMill North if UUID known from earlier attach; keep data.gov as fallback
    dataGovId: "80446967-46ef-4283-bf65-1014ecfc4fbc",
  },
};

async function main() {
  const sqlite = new Database(DB_PATH);
  const have = new Set(
    (
      sqlite
        .prepare(
          `SELECT c.slug FROM councils c
           JOIN transactions t ON t.council_id=c.id GROUP BY c.id`
        )
        .all() as { slug: string }[]
    ).map((r) => r.slug)
  );

  let n = 0;
  for (const [slug, cfg] of Object.entries(DIRECT)) {
    if (have.has(slug)) continue;
    const row = sqlite
      .prepare(`SELECT id FROM councils WHERE slug = ?`)
      .get(slug) as { id: number } | undefined;
    if (!row) {
      console.log(`missing ${slug}`);
      continue;
    }
    if (cfg.dataGovId) {
      sqlite
        .prepare(
          `UPDATE councils SET data_gov_id = ?, scrape_status = 'active' WHERE id = ?`
        )
        .run(cfg.dataGovId, row.id);
    }
    if (cfg.url) {
      sqlite
        .prepare(
          `UPDATE councils SET transparency_url = ?, scrape_status = 'active', data_gov_id = NULL WHERE id = ?`
        )
        .run(cfg.url, row.id);
    }
    console.log(`activated ${slug}`, cfg);
    n++;
  }
  console.log(`Updated ${n}`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
