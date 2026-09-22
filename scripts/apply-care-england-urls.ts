/**
 * Apply Care England curated £500-payments page URLs, then probe which
 * actually yield spreadsheet links via discoverFiles (HTML path only).
 *
 * Usage: npx tsx scripts/apply-care-england-urls.ts [--probe-only]
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { discoverFiles } from "./lib/discover";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const OUT = path.join(process.cwd(), "data", "care-england-probe.json");

/** Care England "Payments Made over £500" directory (Jul 2026 scrape). */
const CARE_ENGLAND: Record<string, string> = {
  "barking-and-dagenham":
    "https://www.lbbd.gov.uk/council-and-democracy/performance-and-spending/corporate-procurement/payments-over-ps250-and-ps500",
  barnet:
    "https://www.barnet.gov.uk/your-council/finance-funding-and-pensions/barnet-council-expenditure",
  barnsley:
    "https://www.barnsley.gov.uk/services/our-council/information-we-publish/expenditure-over-gbp500/",
  "bath-and-north-east-somerset":
    "https://beta.bathnes.gov.uk/expenditure-over-ps500",
  bedford:
    "https://www.bedford.gov.uk/your-council/about-council/council-budgets-and-spending/supplier-payments/payments-over-ps250",
  bexley:
    "https://www.bexley.gov.uk/bexley-business-employment/business-services/contracts-tenders-and-procurement/expenditure-records/publication-payments-over-ps500",
  birmingham:
    "https://www.cityobservatory.birmingham.gov.uk/@birmingham-city-council/payments-to-suppliers-over-500",
  "blackburn-with-darwen": "https://datashare.blackburn.gov.uk/node/2",
  blackpool:
    "https://www.blackpool.gov.uk/Your-Council/Transparency-and-open-data/Budget,-spending-and-procurement/Payments-over-250.aspx",
  bolton: "https://www.bolton.gov.uk/downloads/download/196/expenditure_reports",
  "bournemouth-christchurch-and-poole":
    "https://www.bcpcouncil.gov.uk/About-the-council/Budgets-and-finance/Payments-to-suppliers.aspx",
  "bracknell-forest":
    "https://www.bracknell-forest.gov.uk/council-and-democracy/finance-and-transparency/transparency",
  bradford:
    "https://www.bradford.gov.uk/open-data/our-datasets/expenditure-greater-than-500-in-value/",
  brent: "https://data.brent.gov.uk/dataset/vq756/what-we-spend",
  "brighton-and-hove":
    "https://www.brighton-hove.gov.uk/council-and-democracy/council-data-and-finance/payments-over-ps250",
  "brighton-and-hove-city":
    "https://www.brighton-hove.gov.uk/council-and-democracy/council-data-and-finance/payments-over-ps250",
  bromley: "https://www.bromley.gov.uk/council-budgets-spending/council-spending",
  buckinghamshire:
    "https://www.buckinghamshire.gov.uk/your-council/spending-contracts-and-transparency/spending-over-500/",
  bury: "https://www.bury.gov.uk/council-and-democracy/budgets-and-spending/payments-to-suppliers",
  calderdale:
    "https://dataworks.calderdale.gov.uk/dataset/2wqx8/payments-to-suppliers",
  "central-bedfordshire":
    "https://www.centralbedfordshire.gov.uk/info/28/transparency/285/council_spending",
  "cheshire-east":
    "https://opendata-cheshireeast.opendata.arcgis.com/search?tags=expenditure%20exceeding%20%C2%A3500",
  "cheshire-west-and-chester":
    "https://www.cheshirewestandchester.gov.uk/your-council/datasets-and-statistics/open-data/expenditure-over-500",
  "city-of-london":
    "https://www.cityoflondon.gov.uk/about-us/budgets-spending/local-authority-expenditure",
  cornwall:
    "https://www.cornwall.gov.uk/the-council-and-democracy/council-spending-and-finance/payments-to-suppliers-where-the-invoiced-payments-are-greater-than-or-equal-to-500/",
  coventry: "https://www.coventry.gov.uk/downloads/download/818/spending_over_500",
  croydon:
    "https://www.croydon.gov.uk/council-and-elections/budgets-and-spending/accounts-and-payments/payments-over-ps500",
  darlington:
    "https://www.darlington.gov.uk/your-council/council-information/financial-information/spending-data/",
  derby:
    "https://www.derby.gov.uk/council-and-democracy/open-data-freedom-of-information/open-data-transparency/",
  devon: "https://www.devon.gov.uk/factsandfigures/dataset/spending-over-500/",
  doncaster:
    "https://www.doncaster.gov.uk/services/the-council-democracy/local-transparency-payments-to-suppliers",
  dorset:
    "https://www.dorsetcouncil.gov.uk/your-council/about-your-council/budgets-and-spending/open-data-and-transparency/payments-to-suppliers-over-500",
  dudley:
    "https://www.dudley.gov.uk/council-community/local-transparency/council-expenditure-over-500/",
  ealing:
    "https://www.ealing.gov.uk/info/201041/council_budgets_and_spending/864/council_spending_over_250",
  "east-riding-of-yorkshire":
    "https://www.eastriding.gov.uk/council/governance-and-spending/budgets-and-spending/council-spending-and-salaries/",
  "east-sussex":
    "https://www.eastsussex.gov.uk/your-council/finance/spend/payments-to-suppliers-over-500",
  enfield:
    "https://www.enfield.gov.uk/services/business-and-licensing/transparency-reports/monthly-report-for-transactions-over-250",
  essex: "https://www.essex.gov.uk/spending-and-council-tax/finance-and-spending-breakdowns",
  gateshead: "https://www.gateshead.gov.uk/article/3456/Expenditure-over-500",
  hackney: "https://hackney.gov.uk/budget-supplier-payments",
  halton:
    "https://www3.halton.gov.uk/Pages/councildemocracy/opendata/Payments-over-500.aspx",
  "hammersmith-and-fulham":
    "https://www.lbhf.gov.uk/councillors-and-democracy/data-and-information/transparency/procurement-and-financial-data",
  hampshire:
    "https://www.hants.gov.uk/aboutthecouncil/informationandstats/opendata/opendatasearch/supplierpayments",
  haringey: "https://www.haringey.gov.uk/business/selling-council/council-expenditure",
  harrow:
    "https://www.harrow.gov.uk/downloads/download/12587/council-budgets-and-spending",
  hartlepool:
    "https://www.hartlepool.gov.uk/downloads/download/262/council_expenditure",
  havering:
    "https://www.havering.gov.uk/info/20044/finance_pensions_and_data/226/spend_over_500",
  herefordshire: "https://www.herefordshire.gov.uk/council/open-data-principles/5",
  hertfordshire:
    "https://www.hertfordshire.gov.uk/about-the-council/freedom-of-information-and-council-data/open-data-statistics-about-hertfordshire/what-we-spend-and-how-we-spend-it/what-we-spend-and-how-we-spend-it.aspx",
  hillingdon: "https://www.hillingdon.gov.uk/article/9044/Council-spending-over-500",
  hounslow: "https://data.hounslow.gov.uk/dataset/council-spending-over-f500",
  "isle-of-wight":
    "https://www.iow.gov.uk/council-and-councillors/transparency-our-data/our-finances/spending-and-finance/",
  islington:
    "https://www.islington.gov.uk/about-the-council/information-governance/freedom-of-information/popular-data/council-spending",
  "kensington-and-chelsea":
    "https://www.rbkc.gov.uk/council-councillors-and-democracy/open-data-and-transparency/transparency-and-open-data",
  kent: "https://www.kent.gov.uk/about-the-council/finance-and-budget/spending/invoices-over-250",
  "kingston-upon-hull":
    "https://www.hull.gov.uk/council-and-democracy/spending-and-performance",
  hull: "https://www.hull.gov.uk/council-and-democracy/spending-and-performance",
  "kingston-upon-thames":
    "https://www.kingston.gov.uk/council-democracy/local-government-transparency-code/2",
  knowsley:
    "https://www.knowsley.gov.uk/your-council/publication-scheme/what-we-spend-and-how-we-spend-it",
  lambeth:
    "https://www.lambeth.gov.uk/about-council/transparency-open-data/financial-information/expenditure-over-ps500",
  lancashire:
    "https://www.lancashire.gov.uk/council/transparency/check-council-spending/",
  leicester:
    "https://data.leicester.gov.uk/explore/dataset/expenditure-exceeding-ps500-2022/information/",
  lewisham:
    "https://lewisham.gov.uk/mayorandcouncil/aboutthecouncil/finances/council-spending-over-250",
  lincolnshire:
    "https://www.lincolnshire.gov.uk/finances-budgets/expenditure-500",
  manchester:
    "https://www.manchester.gov.uk/info/200110/budgets_and_spending/5022/publication_of_supplier_transactions_over_500",
  medway: "https://www.medway.gov.uk/info/200216/finances/348/council_finances/2",
  merton:
    "https://www.merton.gov.uk/council-and-local-democracy/data-protection-and-freedom-of-information/open-data/spending-over-500",
  middlesbrough:
    "https://middlesbrough-council-middlesbrough.opendata.arcgis.com/search?q=spend%20over%20500",
  "milton-keynes":
    "https://www.milton-keynes.gov.uk/your_council-and-elections/council-information-and-accounts/data-performance-and-spending/milton",
  newham: "https://www.newham.gov.uk/council/council-spending",
  norfolk:
    "https://www.norfolk.gov.uk/what-we-do-and-how-we-work/open-data-fois-and-data-protection/open-data/payments-to-suppliers",
  "north-east-lincolnshire":
    "https://www.nelincs.gov.uk/your-council/finances-spending-and-contracts/council-spending/published-spending-data/",
  "north-lincolnshire":
    "https://www.northlincs.gov.uk/your-council/supplier-payments/",
  "north-northamptonshire":
    "https://www.northnorthants.gov.uk/finance/expenditure",
  "north-somerset":
    "https://www.n-somerset.gov.uk/council-democracy/accounts-spending-insurance/accounts-budget/spending-over-ps250",
  "north-yorkshire":
    "https://hub.datanorthyorkshire.org/dataset/north-yorkshire-council-2024-2025-over-f500-spend-by-quarter",
  northumberland: "https://www.northumberland.gov.uk/About/Transparency.aspx",
  nottinghamshire:
    "https://www.nottinghamshire.gov.uk/council-and-democracy/finance-and-budget/council-funding-spending/council-spending-information",
  nottingham:
    "https://www.nottinghamcity.gov.uk/your-council/about-the-council/access-to-information/nottingham-data-hub",
  oldham: "https://www.oldham.gov.uk/downloads/download/789/council_expenditure_over_500",
  oxfordshire:
    "https://www.oxfordshire.gov.uk/council/about-your-council/council-tax-and-finance/financial-transparency",
  peterborough:
    "https://data.cambridgeshireinsight.org.uk/dataset/peterborough-payments-over-%C2%A3500-suppliers",
  portsmouth:
    "https://www.portsmouth.gov.uk/services/council-and-democracy/transparency/payments-to-suppliers/",
  reading:
    "https://www.reading.gov.uk/the-council-and-democracy/finance-and-legal-information/council-spending-over-500/",
  redbridge: "https://data.redbridge.gov.uk/View/finance",
  "redcar-and-cleveland":
    "https://www.redcar-cleveland.gov.uk/about-the-council/budget-and-accounts/invoices-over-500",
  "richmond-upon-thames":
    "https://www.richmond.gov.uk/council_payments_to_suppliers",
  rotherham:
    "https://www.rotherham.gov.uk/council/data-transparency-code/2",
  rutland:
    "https://www.rutland.gov.uk/council-councillors/budgets-finance/council-spending",
  salford:
    "https://www.salford.gov.uk/your-council/finance/council-expenditure-over-500/",
  sandwell:
    "https://www.sandwell.gov.uk/info/200202/performance_and_spending/1079/payments_over_500",
  sefton:
    "https://www.sefton.gov.uk/transparency/transparency/council-spend-other-key-documents/council-spend-over-500/",
  shropshire:
    "https://www.shropshire.gov.uk/open-data/datasets/supplier-payments-over-500/",
  slough:
    "https://www.slough.gov.uk/downloads/download/206/payments-to-suppliers-over-500",
  solihull:
    "https://www.solihull.gov.uk/About-the-Council/What-we-spend-and-how-we-spend-it",
  somerset:
    "https://www.somerset.gov.uk/council-and-democracy/find-council-spend-over-500-directory/",
  "south-tyneside":
    "https://www.southtyneside.gov.uk/article/1350/Council-spending-over-500",
  southampton:
    "https://www.southampton.gov.uk/council-democracy/council-data/expenditure-over-fivehundred/",
  "southend-on-sea":
    "https://www.southend.gov.uk/council-budgets-spending/spending-500",
  southwark:
    "https://www.southwark.gov.uk/council-and-democracy/open-data?chapter=2",
  "st-helens": "https://www.sthelens.gov.uk/article/4545/Payments-to-suppliers",
  "stoke-on-trent": "https://www.stoke.gov.uk/directory/27/data_directory",
  suffolk:
    "https://www.suffolk.gov.uk/council-and-democracy/open-data-suffolk/council-data-and-transparency/council-expenditure-and-contracts",
  sunderland: "https://sunderland.gov.uk/over500",
  surrey: "https://www.surreyi.gov.uk/dataset/e6rgn/council-spending",
  sutton:
    "https://www.sutton.gov.uk/w/local-government-transparency-code",
  swindon:
    "https://www.swindon.gov.uk/downloads/download/2285/payments_to_suppliers_of_more_than_500_in_2022",
  tameside: "https://www.tameside.gov.uk/Legal/Transparency-in-Local-Government",
  "telford-and-wrekin":
    "https://www.telford.gov.uk/info/20110/budgets_and_spending/55/expenditure_over_100",
  thurrock: "https://www.thurrock.gov.uk/what-we-spend/payments-to-suppliers",
  torbay: "https://www.torbay.gov.uk/council/finance/expenditure/",
  "tower-hamlets":
    "https://www.towerhamlets.gov.uk/lgnl/council_and_democracy/Transparency/payments_to_suppliers.aspx",
  walsall: "https://go.walsall.gov.uk/your-council/open-data/datasets",
  "waltham-forest":
    "https://www.walthamforest.gov.uk/council-and-elections/about-us/council-budgets-and-spending",
  wandsworth:
    "https://www.wandsworth.gov.uk/the-council/how-the-council-works/council-finances/council-expenditure/",
  warrington: "https://www.warrington.gov.uk/council-spending-over-ps500",
  warwickshire:
    "https://www.warwickshire.gov.uk/directory/42/warwickshire-open-data/category/290",
  "west-berkshire":
    "https://www.westberks.gov.uk/article/40316/Expenditure-Over-500",
  "west-northamptonshire":
    "https://www.westnorthants.gov.uk/your-council/expenditure",
  "west-sussex":
    "https://www.westsussex.gov.uk/about-the-council/information-and-data/data-store/local-government-transparency-code-data/",
  westminster:
    "https://www.westminster.gov.uk/about-council/transparency/spending-procurement-and-data-transparency",
  wiltshire: "https://www.wiltshire.gov.uk/article/1392/Council-payments",
  "windsor-and-maidenhead":
    "https://www.rbwm.gov.uk/home/council-and-democracy/transparency/budget-spending-and-procurement",
  wokingham:
    "https://www.wokingham.gov.uk/council-and-meetings/open-data/datasets-and-open-data/",
  wolverhampton:
    "https://www.wolverhampton.gov.uk/your-council/corporate-finance/transparency-and-accountability-payments-suppliers",
  worcestershire:
    "https://www.worcestershire.gov.uk/council-finance/payments-commercial-suppliers-over-ps500-and-government-procurement-card",
};

async function main() {
  const probeOnly = process.argv.includes("--probe-only");
  const sqlite = new Database(DB_PATH);

  const already = new Set(
    (
      sqlite
        .prepare(
          `SELECT c.slug FROM councils c
           JOIN transactions t ON t.council_id = c.id GROUP BY c.id`
        )
        .all() as { slug: string }[]
    ).map((r) => r.slug)
  );

  if (!probeOnly) {
    let updated = 0;
    for (const [slug, url] of Object.entries(CARE_ENGLAND)) {
      if (already.has(slug)) continue;
      const row = sqlite
        .prepare(`SELECT id FROM councils WHERE slug = ?`)
        .get(slug) as { id: number } | undefined;
      if (!row) continue;
      const dg = sqlite
        .prepare(`SELECT data_gov_id AS id FROM councils WHERE id = ?`)
        .get(row.id) as { id: string | null };
      // Keep working datamill; clear dead data.gov.uk so HTML wins
      if (dg.id && !String(dg.id).startsWith("datamill:") && !String(dg.id).startsWith("ckan:")) {
        sqlite.prepare(`UPDATE councils SET data_gov_id = NULL WHERE id = ?`).run(row.id);
      }
      sqlite
        .prepare(
          `UPDATE councils SET transparency_url = ?, scrape_status = 'active' WHERE id = ?`
        )
        .run(url, row.id);
      updated++;
    }
    // North Yorkshire: prefer live regional CKAN
    const ny = sqlite
      .prepare(`SELECT id FROM councils WHERE slug = 'north-yorkshire'`)
      .get() as { id: number } | undefined;
    if (ny && !already.has("north-yorkshire")) {
      sqlite
        .prepare(
          `UPDATE councils SET data_gov_id = ?, transparency_url = ?, scrape_status = 'active'
           WHERE id = ?`
        )
        .run(
          "ckan:hub.datanorthyorkshire.org/north-yorkshire-council-2024-2025-over-f500-spend-by-quarter",
          CARE_ENGLAND["north-yorkshire"],
          ny.id
        );
    }
    console.log(`Updated/activated ${updated} Care England URLs`);
  }

  const rows = sqlite
    .prepare(
      `SELECT slug, name, transparency_url AS url FROM councils
       WHERE scrape_status = 'active'
         AND id NOT IN (SELECT DISTINCT council_id FROM transactions)
         AND transparency_url IS NOT NULL AND length(transparency_url) > 0
       ORDER BY slug`
    )
    .all() as { slug: string; name: string; url: string }[];

  console.log(`Probing ${rows.length} councils...`);
  const good: Array<{ slug: string; files: number }> = [];
  const bad: Array<{ slug: string; reason: string }> = [];

  for (let i = 0; i < rows.length; i += 8) {
    const batch = rows.slice(i, i + 8);
    const results = await Promise.all(
      batch.map(async (r) => {
        try {
          const files = await discoverFiles({
            slug: r.slug,
            name: r.name,
            transparencyUrl: r.url,
            dataGovId:
              r.slug === "north-yorkshire"
                ? "ckan:hub.datanorthyorkshire.org/north-yorkshire-council-2024-2025-over-f500-spend-by-quarter"
                : null,
          });
          return { slug: r.slug, n: files.length };
        } catch (e) {
          return { slug: r.slug, n: 0, err: String(e).slice(0, 140) };
        }
      })
    );
    for (const r of results) {
      if (r.n > 0) {
        good.push({ slug: r.slug, files: r.n });
        console.log(`  GOOD ${r.slug} (${r.n})`);
        sqlite
          .prepare(`UPDATE councils SET scrape_status = 'active' WHERE slug = ?`)
          .run(r.slug);
      } else {
        bad.push({ slug: r.slug, reason: (r as { err?: string }).err || "0 files" });
        console.log(`  BAD  ${r.slug}`);
        sqlite
          .prepare(`UPDATE councils SET scrape_status = 'pending' WHERE slug = ?`)
          .run(r.slug);
      }
    }
  }

  // Keep already-ingested active
  sqlite.exec(
    `UPDATE councils SET scrape_status='active'
     WHERE id IN (SELECT DISTINCT council_id FROM transactions)`
  );

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        goodCount: good.length,
        badCount: bad.length,
        good,
        bad,
      },
      null,
      2
    )
  );
  console.log(`\nGood: ${good.length} → ${OUT}`);
  console.log(good.map((g) => g.slug).join(","));
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
