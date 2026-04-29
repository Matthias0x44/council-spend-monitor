/**
 * Seed the council registry from data.gov.uk CKAN API + manual curation.
 *
 * Usage:
 *   npx tsx scripts/seed-registry.ts
 *
 * This discovers councils that publish spending data on data.gov.uk,
 * then supplements with a manually curated list of major councils
 * whose transparency pages are known.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as path from "path";
import * as fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bcouncil\b/gi, "")
    .replace(/\bcity of\b/gi, "")
    .replace(/\bborough of\b/gi, "")
    .replace(/\broyal borough of\b/gi, "")
    .replace(/\blondon borough of\b/gi, "")
    .replace(/\bmetropolitan borough\b/gi, "")
    .replace(/\bdistrict\b/gi, "")
    .replace(/\bcounty\b/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// data.gov.uk CKAN discovery
// ---------------------------------------------------------------------------

interface CkanPackage {
  id: string;
  name: string;
  title: string;
  organization?: { title: string; name: string };
  resources: { format: string }[];
}

interface CkanSearchResult {
  success: boolean;
  result: {
    count: number;
    results: CkanPackage[];
  };
}

async function searchCkan(): Promise<
  { title: string; org: string; dataGovId: string }[]
> {
  const results: { title: string; org: string; dataGovId: string }[] = [];
  const queries = [
    "spending+over+500",
    "council+spend+over+500",
    "expenditure+over+500",
    "transparency+spending",
  ];

  const seen = new Set<string>();

  for (const q of queries) {
    let offset = 0;
    const pageSize = 100;

    while (true) {
      const url = `https://data.gov.uk/api/action/package_search?q=${q}&rows=${pageSize}&start=${offset}`;
      let data: CkanSearchResult;
      try {
        const res = await fetch(url);
        if (!res.ok) break;
        data = (await res.json()) as CkanSearchResult;
      } catch {
        break;
      }

      if (!data.success || data.result.results.length === 0) break;

      for (const pkg of data.result.results) {
        if (seen.has(pkg.id)) continue;
        seen.add(pkg.id);

        const hasSpreadsheets = pkg.resources.some((r) =>
          ["csv", "xlsx", "xls"].includes(r.format?.toLowerCase().trim())
        );
        if (!hasSpreadsheets) continue;

        results.push({
          title: pkg.title,
          org: pkg.organization?.title || pkg.organization?.name || "",
          dataGovId: pkg.id,
        });
      }

      offset += pageSize;
      if (offset >= data.result.count) break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Manually curated councils (major cities and metro boroughs)
// ---------------------------------------------------------------------------

interface ManualCouncil {
  name: string;
  slug: string;
  region: string;
  transparencyUrl?: string;
}

const MANUAL_COUNCILS: ManualCouncil[] = [
  // Already scraped
  { name: "Kirklees Council", slug: "kirklees", region: "West Yorkshire", transparencyUrl: "https://www.kirklees.gov.uk/beta/information-and-data/expenditure-data.aspx" },

  // Major metro boroughs — verified URLs April 2026
  { name: "Birmingham City Council", slug: "birmingham", region: "West Midlands", transparencyUrl: "https://www.birmingham.gov.uk/info/20215/corporate_procurement_services/517/invoicing_the_council/5" },
  { name: "Manchester City Council", slug: "manchester", region: "Greater Manchester", transparencyUrl: "https://www.manchester.gov.uk/open-data/local-government-transparency-code" },
  { name: "Leeds City Council", slug: "leeds", region: "West Yorkshire", transparencyUrl: "https://datamillnorth.org/dataset/council-spending-2gpp0" },
  { name: "Sheffield City Council", slug: "sheffield", region: "South Yorkshire", transparencyUrl: "https://datamillnorth.org/dataset/council-spend-over-250-emd0m" },
  { name: "Liverpool City Council", slug: "liverpool", region: "Merseyside", transparencyUrl: "https://liverpool.gov.uk/council/spending-and-performance/transparency-in-local-government/" },
  { name: "Bristol City Council", slug: "bristol", region: "South West", transparencyUrl: "https://www.bristol.gov.uk/council/council-spending-and-performance/spending-over-500" },
  { name: "Newcastle City Council", slug: "newcastle", region: "Tyne and Wear" },
  { name: "Nottingham City Council", slug: "nottingham", region: "East Midlands" },
  { name: "Leicester City Council", slug: "leicester", region: "East Midlands" },
  { name: "Coventry City Council", slug: "coventry", region: "West Midlands" },

  // London boroughs
  { name: "Westminster City Council", slug: "westminster", region: "London" },
  { name: "Camden Council", slug: "camden", region: "London" },
  { name: "Tower Hamlets Council", slug: "tower-hamlets", region: "London" },
  { name: "Hackney Council", slug: "hackney", region: "London" },
  { name: "Islington Council", slug: "islington", region: "London" },
  { name: "Lambeth Council", slug: "lambeth", region: "London" },
  { name: "Southwark Council", slug: "southwark", region: "London" },
  { name: "Newham Council", slug: "newham", region: "London" },
  { name: "Barnet Council", slug: "barnet", region: "London" },
  { name: "Croydon Council", slug: "croydon", region: "London" },
  { name: "Ealing Council", slug: "ealing", region: "London" },
  { name: "Haringey Council", slug: "haringey", region: "London" },
  { name: "Hounslow Council", slug: "hounslow", region: "London" },
  { name: "Greenwich Council", slug: "greenwich", region: "London" },
  { name: "Lewisham Council", slug: "lewisham", region: "London" },
  { name: "Wandsworth Council", slug: "wandsworth", region: "London" },

  // County councils
  { name: "Kent County Council", slug: "kent", region: "South East" },
  { name: "Hampshire County Council", slug: "hampshire", region: "South East" },
  { name: "Surrey County Council", slug: "surrey", region: "South East" },
  { name: "Essex County Council", slug: "essex", region: "East of England" },
  { name: "Lancashire County Council", slug: "lancashire", region: "North West" },
  { name: "Devon County Council", slug: "devon", region: "South West" },
  { name: "Norfolk County Council", slug: "norfolk", region: "East of England" },
  { name: "Suffolk County Council", slug: "suffolk", region: "East of England" },
  { name: "Hertfordshire County Council", slug: "hertfordshire", region: "East of England" },

  // Unitaries and others
  { name: "Bradford Council", slug: "bradford", region: "West Yorkshire" },
  { name: "Calderdale Council", slug: "calderdale", region: "West Yorkshire" },
  { name: "Wakefield Council", slug: "wakefield", region: "West Yorkshire" },
  { name: "Rochdale Borough Council", slug: "rochdale", region: "Greater Manchester" },
  { name: "Bolton Council", slug: "bolton", region: "Greater Manchester" },
  { name: "Wigan Council", slug: "wigan", region: "Greater Manchester" },
  { name: "Stockport Council", slug: "stockport", region: "Greater Manchester" },
  { name: "Tameside Council", slug: "tameside", region: "Greater Manchester" },
  { name: "Oldham Council", slug: "oldham", region: "Greater Manchester" },
  { name: "Trafford Council", slug: "trafford", region: "Greater Manchester" },
  { name: "Salford City Council", slug: "salford", region: "Greater Manchester" },
  { name: "Bury Council", slug: "bury", region: "Greater Manchester" },
  { name: "Sunderland City Council", slug: "sunderland", region: "Tyne and Wear" },
  { name: "Gateshead Council", slug: "gateshead", region: "Tyne and Wear" },
  { name: "Cornwall Council", slug: "cornwall", region: "South West" },
  { name: "Plymouth City Council", slug: "plymouth", region: "South West" },
  { name: "Milton Keynes Council", slug: "milton-keynes", region: "South East" },

  // Scottish councils
  { name: "City of Edinburgh Council", slug: "edinburgh", region: "Scotland" },
  { name: "Glasgow City Council", slug: "glasgow", region: "Scotland" },
  { name: "Aberdeen City Council", slug: "aberdeen", region: "Scotland" },
  { name: "Dundee City Council", slug: "dundee", region: "Scotland" },

  // Welsh councils
  { name: "Cardiff Council", slug: "cardiff", region: "Wales" },
  { name: "Swansea Council", slug: "swansea", region: "Wales" },
  { name: "Newport City Council", slug: "newport", region: "Wales" },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Ensure full schema exists (fresh DB on CI)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS councils (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      region TEXT,
      transparency_url TEXT,
      data_gov_id TEXT,
      scrape_profile TEXT,
      scrape_status TEXT DEFAULT 'pending',
      last_scraped_at TEXT,
      file_pattern TEXT
    );
    CREATE TABLE IF NOT EXISTS financial_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      label TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      name TEXT NOT NULL,
      normalised_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      financial_year_id INTEGER REFERENCES financial_years(id),
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      downloaded_at TEXT,
      column_mapping TEXT
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_id INTEGER NOT NULL REFERENCES councils(id),
      financial_year_id INTEGER REFERENCES financial_years(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      service TEXT,
      directorate TEXT,
      category TEXT,
      description TEXT,
      amount REAL NOT NULL,
      date TEXT,
      month TEXT,
      source_document_id INTEGER REFERENCES source_documents(id)
    );
  `);

  // Migrate existing DBs that may be missing new columns
  const migrations = [
    "ALTER TABLE councils ADD COLUMN transparency_url TEXT",
    "ALTER TABLE councils ADD COLUMN data_gov_id TEXT",
    "ALTER TABLE councils ADD COLUMN scrape_profile TEXT",
    "ALTER TABLE councils ADD COLUMN scrape_status TEXT DEFAULT 'pending'",
    "ALTER TABLE councils ADD COLUMN last_scraped_at TEXT",
    "ALTER TABLE councils ADD COLUMN file_pattern TEXT",
    "ALTER TABLE source_documents ADD COLUMN column_mapping TEXT",
  ];
  for (const m of migrations) {
    try { sqlite.exec(m); } catch { /* column already exists */ }
  }

  const db = drizzle(sqlite, { schema });

  // 1) Insert manual councils
  console.log("Seeding manually curated councils...");
  let insertedManual = 0;
  let updatedManual = 0;

  for (const mc of MANUAL_COUNCILS) {
    const existing = db
      .select()
      .from(schema.councils)
      .where(eq(schema.councils.slug, mc.slug))
      .get();

    if (existing) {
      // Update transparency URL if we have one and it's missing
      if (mc.transparencyUrl && !existing.transparencyUrl) {
        sqlite.exec(
          `UPDATE councils SET transparency_url = '${mc.transparencyUrl}' WHERE id = ${existing.id}`
        );
        updatedManual++;
      }
      // Mark Kirklees as active (already has data)
      if (mc.slug === "kirklees") {
        sqlite.exec(
          `UPDATE councils SET scrape_status = 'active', transparency_url = '${mc.transparencyUrl}' WHERE id = ${existing.id}`
        );
      }
    } else {
      db.insert(schema.councils)
        .values({
          name: mc.name,
          slug: mc.slug,
          region: mc.region,
          transparencyUrl: mc.transparencyUrl || null,
          scrapeStatus: mc.slug === "kirklees" ? "active" : "pending",
        })
        .run();
      insertedManual++;
    }
  }

  console.log(`  Manual: ${insertedManual} inserted, ${updatedManual} updated`);

  // 2) Search data.gov.uk CKAN for spending datasets
  console.log("\nSearching data.gov.uk for council spending datasets...");
  let ckanMatches = 0;

  try {
    const ckanResults = await searchCkan();
    console.log(`  Found ${ckanResults.length} datasets with CSV/XLSX resources`);

    for (const result of ckanResults) {
      // Try to match to an existing council by org name
      const orgSlug = slugify(result.org);
      if (!orgSlug) continue;

      const existing = db
        .select()
        .from(schema.councils)
        .where(eq(schema.councils.slug, orgSlug))
        .get();

      if (existing) {
        if (!existing.dataGovId) {
          sqlite.exec(
            `UPDATE councils SET data_gov_id = '${result.dataGovId}' WHERE id = ${existing.id}`
          );
          ckanMatches++;
        }
      } else {
        // Insert as a new council with CKAN data
        try {
          db.insert(schema.councils)
            .values({
              name: result.org || result.title,
              slug: orgSlug,
              region: null,
              dataGovId: result.dataGovId,
              scrapeStatus: "pending",
            })
            .run();
          ckanMatches++;
        } catch {
          // Slug collision — skip
        }
      }
    }
  } catch (err) {
    console.warn(`  CKAN search failed: ${err}`);
  }

  console.log(`  CKAN: ${ckanMatches} councils matched or added`);

  // Summary
  const allCouncils = db.select().from(schema.councils).all();
  const byStatus = {
    active: allCouncils.filter((c) => c.scrapeStatus === "active").length,
    pending: allCouncils.filter((c) => c.scrapeStatus === "pending").length,
    failing: allCouncils.filter((c) => c.scrapeStatus === "failing").length,
  };

  console.log(`\nRegistry total: ${allCouncils.length} councils`);
  console.log(`  Active: ${byStatus.active}`);
  console.log(`  Pending: ${byStatus.pending}`);
  console.log(`  Failing: ${byStatus.failing}`);

  // List councils with a data source (transparency URL or CKAN ID)
  const withSource = allCouncils.filter(
    (c) => c.transparencyUrl || c.dataGovId
  );
  console.log(`  With data source: ${withSource.length}`);

  sqlite.close();
}

main().catch((err) => {
  console.error("Seed registry failed:", err);
  process.exit(1);
});
