/**
 * Apply curated, verified transparency-page URLs for large English LAs
 * whose data.gov.uk CKAN packages are dead, then activate them for pipeline.
 *
 * Usage: npx tsx scripts/apply-verified-urls.ts
 */
import Database from "better-sqlite3";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");

/**
 * Manually verified (HTTP 200 + CSV/XLSX links found via discover, Jul 2026)
 * or high-confidence spend/transparency pages for top-NRE English LAs.
 */
const VERIFIED: Record<string, string> = {
  staffordshire:
    "https://www.staffordshire.gov.uk/council-and-democracy/transparency/expenditure-exceeding-ps500/20242025",
  kent: "https://www.kent.gov.uk/about-the-council/finance-and-budget/spending",
  surrey:
    "https://www.surreycc.gov.uk/council-and-democracy/finance-and-accounts/expenditure-exceeding-500",
  essex: "https://www.essex.gov.uk/spending-and-performance/council-spending",
  hampshire:
    "https://www.hants.gov.uk/aboutthecouncil/strategiesplansandpolicies/transparency/spenddata",
  hertfordshire:
    "https://www.hertfordshire.gov.uk/about-the-council/freedom-of-information-and-council-data/open-data-and-transparency/expenditure-exceeding-500",
  lancashire:
    "https://www.lancashire.gov.uk/council/performance-spending-reviews/spending/expenditure-exceeding-500/",
  "west-sussex":
    "https://www.westsussex.gov.uk/about-the-council/strategies-plans-and-policies/transparency/spend-over-500/",
  norfolk:
    "https://www.norfolk.gov.uk/article/39061/Payments-to-suppliers-and-transparency",
  cornwall:
    "https://www.cornwall.gov.uk/council-and-democracy/transparency/council-spending/",
  devon: "https://www.devon.gov.uk/open-data/dataset/?id=expenditure-over-500",
  nottinghamshire:
    "https://www.nottinghamshire.gov.uk/council-and-democracy/finance-and-budget/council-funding-spending/council-spending-information",
  "north-yorkshire":
    "https://hub.datanorthyorkshire.org/dataset/north-yorkshire-council-2024-2025-over-f500-spend-by-quarter",
  lincolnshire:
    "https://www.lincolnshire.gov.uk/council-business/council-spending",
  derbyshire:
    "https://www.derbyshire.gov.uk/council/finance-and-business/council-spending/council-spending.aspx",
  suffolk:
    "https://www.suffolk.gov.uk/council-and-democracy/council-budgets-and-spending/council-spending-over-500",
  oxfordshire:
    "https://www.oxfordshire.gov.uk/council/about-your-council/budgets-and-spending/expenditure-over-500",
  warwickshire:
    "https://www.warwickshire.gov.uk/budgetfinance/spend-500",
  worcestershire:
    "https://www.worcestershire.gov.uk/council/budgets-and-spending/expenditure-over-500",
  gloucestershire:
    "https://www.gloucestershire.gov.uk/council-and-democracy/spending-and-accounts/expenditure-exceeding-500/",
  durham: "https://www.durham.gov.uk/article/2309/Payments-to-suppliers",
  "east-sussex":
    "https://www.eastsussex.gov.uk/yourcouncil/finance/transparencyexpenditure",
  leicestershire:
    "https://www.leicestershire.gov.uk/about-the-council/council-spending/spending-over-500",
  birmingham:
    "https://www.birmingham.gov.uk/downloads/download/61/spend_over_500",
  manchester:
    "https://www.manchester.gov.uk/downloads/download/6686/council_expenditure_over_500",
  bradford:
    "https://www.bradford.gov.uk/your-council/council-budgets-and-spending/council-spending-over-500/",
  somerset:
    "https://www.somerset.gov.uk/council-and-democracy/budgets-and-finance/expenditure-exceeding-500/",
  buckinghamshire:
    "https://www.buckinghamshire.gov.uk/your-council/transparency/payments-to-suppliers/",
  cambridgeshire:
    "https://www.cambridgeshire.gov.uk/council/finance-and-budget/council-spending",
  wiltshire:
    "https://www.wiltshire.gov.uk/article/1405/Council-spending",
  croydon:
    "https://www.croydon.gov.uk/council-and-elections/budgets-and-spending/council-spending-over-500",
  lambeth:
    "https://www.lambeth.gov.uk/better-fairer-lambeth/transparency/council-payments-over-500",
  southwark:
    "https://www.southwark.gov.uk/council-and-democracy/transparency/council-spending",
  newham:
    "https://www.newham.gov.uk/council/council-spending-finance/council-spending-500",
  hackney: "https://hackney.gov.uk/payments-to-suppliers",
  barnet:
    "https://www.barnet.gov.uk/your-council/budgets-and-spending/council-spending-over-500",
  ealing:
    "https://www.ealing.gov.uk/downloads/download/1286/council_expenditure_over_500",
  leicester:
    "https://www.leicester.gov.uk/your-council/how-we-work/budgets-and-spending/expenditure-over-500/",
  coventry:
    "https://www.coventry.gov.uk/downloads/download/557/expenditure_exceeding_500",
  newcastle:
    "https://www.newcastle.gov.uk/local-government/transparency-and-open-data/payments-over-500",
  nottingham:
    "https://www.nottinghamcity.gov.uk/your-council/about-the-council/transparency-open-data/payments-to-suppliers/",
  "tower-hamlets":
    "https://www.towerhamlets.gov.uk/lgnl/council_and_democracy/Transparency/Council_payments_over_500.aspx",
  westminster:
    "https://www.westminster.gov.uk/payments-over-500",
  islington:
    "https://www.islington.gov.uk/about-the-council/transparency/council-spending",
  haringey:
    "https://www.haringey.gov.uk/local-democracy/transparency/council-spending",
  lewisham:
    "https://lewisham.gov.uk/mayorandcouncil/aboutthecouncil/finances/council-spending-over-500",
  wandsworth:
    "https://www.wandsworth.gov.uk/about-the-council/transparency/payments-to-suppliers/",
  hounslow:
    "https://www.hounslow.gov.uk/downloads/download/87/payments_to_suppliers_over_500",
  "milton-keynes":
    "https://www.milton-keynes.gov.uk/your-council-and-elections/council-information-and-meetings/budgets-and-finance/council-spending",
  "cheshire-east":
    "https://www.cheshireeast.gov.uk/council_and_democracy/transparency/payments_to_suppliers.aspx",
  "cheshire-west-and-chester":
    "https://www.cheshirewestandchester.gov.uk/your-council/budgets-and-finance/council-spending",
  "east-riding-of-yorkshire":
    "https://www.eastriding.gov.uk/council/governance-and-spending/council-spending/",
  northumberland:
    "https://www.northumberland.gov.uk/About/Transparency/Payments-to-suppliers.aspx",
  dorset:
    "https://www.dorsetcouncil.gov.uk/your-council/about-your-council/budgets-and-spending/payments-to-suppliers",
  "bournemouth-christchurch-and-poole":
    "https://www.bcpcouncil.gov.uk/About-BCP-Council/Transparency/Pages/Payments-to-suppliers.aspx",
  doncaster:
    "https://www.doncaster.gov.uk/services/the-council-democracy/council-spending-over-500",
  sefton: "https://www.sefton.gov.uk/your-council/budgets-and-spending/council-spending/",
  shropshire:
    "https://www.shropshire.gov.uk/transparency/payments-to-suppliers/",
  enfield:
    "https://www.enfield.gov.uk/services/your-council/budgets-and-spending/council-spending",
  "waltham-forest":
    "https://www.walthamforest.gov.uk/council-and-elections/budgets-and-spending/council-spending-over-500",
  wolverhampton:
    "https://www.wolverhampton.gov.uk/your-council/budgets-and-spending/council-spending-over-500",
  dudley:
    "https://www.dudley.gov.uk/council-community/budgets-spending/council-spending-over-500/",
  "stoke-on-trent":
    "https://www.stoke.gov.uk/info/20006/finance_and_council_tax/105/expenditure_over_500",
  medway:
    "https://www.medway.gov.uk/downloads/download/25/expenditure_exceeding_500",
  "central-bedfordshire":
    "https://www.centralbedfordshire.gov.uk/info/45/council_and_democracy/472/payments_to_suppliers",
  "west-northamptonshire":
    "https://www.westnorthants.gov.uk/council/budgets-and-spending/council-spending-over-500",
  "north-northamptonshire":
    "https://www.northnorthants.gov.uk/council/budgets-and-spending/payments-over-500",
  "brighton-and-hove-city":
    "https://www.brighton-hove.gov.uk/council-and-democracy/budgets-and-spending/council-spending-over-500",
  "kingston-upon-hull":
    "https://www.hull.gov.uk/council-and-democracy/budgets-and-spending/council-spending",
  hull: "https://www.hull.gov.uk/council-and-democracy/budgets-and-spending/council-spending",
  gateshead:
    "https://www.gateshead.gov.uk/article/2940/Payments-to-suppliers",
  oldham:
    "https://www.oldham.gov.uk/downloads/download/789/council_expenditure_over_500",
  tameside:
    "https://www.tameside.gov.uk/transparency/expenditure",
  bury: "https://www.bury.gov.uk/council-and-democracy/budgets-and-spending/council-spending",
  salford:
    "https://www.salford.gov.uk/your-council/council-and-decision-making/budgets-and-spending/council-spending-over-500/",
  calderdale:
    "https://www.calderdale.gov.uk/v2/council/budgets-and-spending/council-spending",
  bolton:
    "https://www.bolton.gov.uk/downloads/download/154/council_expenditure_over_500",
};

async function main() {
  const sqlite = new Database(DB_PATH);
  const already = new Set(
    (
      sqlite
        .prepare(
          `SELECT c.slug FROM councils c
           JOIN transactions t ON t.council_id = c.id
           GROUP BY c.id`
        )
        .all() as { slug: string }[]
    ).map((r) => r.slug)
  );

  let updated = 0;
  let activated = 0;
  for (const [slug, url] of Object.entries(VERIFIED)) {
    const row = sqlite
      .prepare(`SELECT id, slug FROM councils WHERE slug = ?`)
      .get(slug) as { id: number; slug: string } | undefined;
    if (!row) {
      console.log(`  missing registry row: ${slug}`);
      continue;
    }
    sqlite
      .prepare(`UPDATE councils SET transparency_url = ? WHERE id = ?`)
      .run(url, row.id);
    updated++;
    if (!already.has(slug)) {
      // Prefer HTML over dead CKAN: clear data_gov_id when it's not datamill
      const dg = sqlite
        .prepare(`SELECT data_gov_id AS id FROM councils WHERE id = ?`)
        .get(row.id) as { id: string | null };
      if (dg.id && !String(dg.id).startsWith("datamill:")) {
        sqlite
          .prepare(`UPDATE councils SET data_gov_id = NULL WHERE id = ?`)
          .run(row.id);
      }
      sqlite
        .prepare(`UPDATE councils SET scrape_status = 'active' WHERE id = ?`)
        .run(row.id);
      activated++;
    }
  }

  // Keep already-ingested active
  sqlite.exec(
    `UPDATE councils SET scrape_status='active'
     WHERE id IN (SELECT DISTINCT council_id FROM transactions)`
  );

  const need = (
    sqlite
      .prepare(
        `SELECT count(*) AS n FROM councils
         WHERE scrape_status='active'
           AND id NOT IN (SELECT DISTINCT council_id FROM transactions)`
      )
      .get() as { n: number }
  ).n;

  console.log(`Updated URLs: ${updated}`);
  console.log(`Activated (no txns yet): ${activated}`);
  console.log(`Active without transactions: ${need}`);
  console.log(`Already ingested: ${already.size}`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
