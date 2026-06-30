/**
 * Throwaway helper: print what discover.ts finds for each council slug
 * passed on the command line.
 *
 * Usage:
 *   npx tsx scripts/probe-discovery.ts bristol leeds stockport
 *
 * If no slugs are given, probes the canonical six.
 */

import Database from "better-sqlite3";
import * as path from "path";
import { discoverFiles } from "./lib/discover";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");

interface CouncilRow {
  slug: string;
  name: string;
  transparency_url: string | null;
  data_gov_id: string | null;
  file_pattern: string | null;
}

async function probe(c: CouncilRow) {
  console.log(`\n=== ${c.slug} (${c.name}) ===`);
  console.log(`  url=${c.transparency_url || "-"}`);
  console.log(`  ckan=${c.data_gov_id || "-"}`);
  console.log(`  filePattern=${c.file_pattern || "-"}`);

  try {
    const files = await discoverFiles({
      slug: c.slug,
      name: c.name,
      transparencyUrl: c.transparency_url,
      dataGovId: c.data_gov_id,
      filePattern: c.file_pattern,
    });
    console.log(`  ${files.length} files`);
    for (const f of files.slice(0, 10)) {
      console.log(`    ${f.filename} | ${f.format} | ${f.url}`);
    }
    if (files.length > 10) console.log(`    ... +${files.length - 10} more`);
  } catch (e) {
    console.log(`  ERROR: ${e}`);
  }
}

async function main() {
  const slugs = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["bristol", "leeds", "stockport", "wigan", "kirklees", "rochdale-borough"];

  const sqlite = new Database(DB_PATH, { readonly: true });
  for (const slug of slugs) {
    const row = sqlite
      .prepare(
        "SELECT slug, name, transparency_url, data_gov_id, file_pattern FROM councils WHERE slug = ?"
      )
      .get(slug) as CouncilRow | undefined;
    if (!row) {
      console.log(`\n=== ${slug} === NOT IN REGISTRY`);
      continue;
    }
    await probe(row);
  }
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
