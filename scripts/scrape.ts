import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const RAW_DIR = path.join(process.cwd(), "data", "raw", "kirklees");

const EXPENDITURE_URL =
  "https://www.kirklees.gov.uk/beta/information-and-data/expenditure-data.aspx";
const BUDGET_URL = "https://www.kirklees.gov.uk/budget";

const BUDGET_PDFS = [
  {
    url: "https://www.kirklees.gov.uk/beta/delivering-services/pdf/2025-26-summary-budget-book.pdf",
    filename: "2025-26-summary-budget-book.pdf",
  },
  {
    url: "https://www.kirklees.gov.uk/beta/delivering-services/pdf/2025-26-budget.pdf",
    filename: "2025-26-budget.pdf",
  },
  {
    url: "https://www.kirklees.gov.uk/beta/delivering-services/pdf/statement-of-accounts-2024-25.pdf",
    filename: "statement-of-accounts-2024-25.pdf",
  },
  {
    url: "https://www.kirklees.gov.uk/beta/delivering-services/pdf/statement-of-accounts-2023-24.pdf",
    filename: "statement-of-accounts-2023-24.pdf",
  },
];

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function downloadFile(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) {
    console.log(`  [skip] ${path.basename(dest)}`);
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  console.log(`  [done] ${path.basename(dest)}`);
}

function extractExpenditureLinks(html: string): { url: string; filename: string }[] {
  const $ = cheerio.load(html);
  const links: { url: string; filename: string }[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (!href.match(/\.(xlsx|csv)$/i)) return;

    const fullUrl = href.startsWith("http")
      ? href
      : `https://www.kirklees.gov.uk${href}`;

    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const filename = decodeURIComponent(fullUrl.split("/").pop() || "")
      .replace(/%20/g, " ")
      .replace(/\s+/g, "-");

    links.push({ url: fullUrl, filename });
  });

  return links;
}

async function scrapeExpenditure(): Promise<void> {
  console.log("Fetching expenditure page...");
  const html = await fetchPage(EXPENDITURE_URL);
  const links = extractExpenditureLinks(html);
  console.log(`Found ${links.length} expenditure files`);

  for (const link of links) {
    const dest = path.join(RAW_DIR, link.filename);
    await downloadFile(link.url, dest);
  }
}

async function scrapeBudgets(): Promise<void> {
  console.log("Downloading budget/accounts PDFs...");
  for (const pdf of BUDGET_PDFS) {
    const dest = path.join(RAW_DIR, pdf.filename);
    await downloadFile(pdf.url, dest);
  }
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  await scrapeExpenditure();
  await scrapeBudgets();

  const files = fs.readdirSync(RAW_DIR);
  console.log(`\nTotal files in data/raw/kirklees: ${files.length}`);
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
