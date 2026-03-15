import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";
// @ts-ignore - pdf-parse v1 uses CommonJS default export
import pdf from "pdf-parse";

const DB_PATH = path.join(process.cwd(), "data", "council-spend.db");
const RAW_DIR = path.join(process.cwd(), "data", "raw", "kirklees");

// Known directorates in Kirklees (used as anchors for parsing)
const DIRECTORATES = [
  "Adults and Health",
  "Children and Families",
  "Place",
  "Homes and Neighbourhoods",
  "Growth and Regeneration",
  "Public Health and Corporate Resources",
  "Corporate Strategy, Commissioning and Public Health",
  "Chief Executive",
  "Central Budgets",
  "Corporate",
];

interface BudgetLine {
  directorate: string;
  service: string;
  netBudget: number | null;
  grossBudget: number | null;
}

interface OutturnLine {
  directorate: string;
  service: string;
  netOutturn: number;
  variance: number;
}

function parseAmount(str: string): number | null {
  if (!str || str === "-" || str === "–") return null;
  const cleaned = str.replace(/[£,\s()]/g, "").replace(/\(([^)]+)\)/, "-$1");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function extractBudgetData(text: string): BudgetLine[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: BudgetLine[] = [];
  let currentDirectorate = "";

  for (const line of lines) {
    // Check if line contains a known directorate
    const matchedDir = DIRECTORATES.find((d) =>
      line.toLowerCase().includes(d.toLowerCase())
    );
    if (matchedDir) {
      currentDirectorate = matchedDir;
    }

    // Look for lines with currency amounts (£XXX,XXX or numbers with commas)
    const amounts = line.match(/[\d,]+\.?\d*/g);
    if (amounts && amounts.length >= 1 && currentDirectorate) {
      // Heuristic: if line has amounts and text before them, treat text as service
      const firstAmountIdx = line.search(/[\d,]+\.?\d*/);
      const serviceText = line.slice(0, firstAmountIdx).trim();

      if (serviceText && serviceText.length > 2 && serviceText.length < 80) {
        const parsedAmounts = amounts.map((a) => parseAmount(a));
        const net = parsedAmounts[parsedAmounts.length - 1]; // last amount is typically net
        const gross = parsedAmounts.length > 1 ? parsedAmounts[0] : null; // first is gross

        if (net !== null && Math.abs(net) > 0) {
          results.push({
            directorate: currentDirectorate,
            service: serviceText,
            netBudget: net * 1000, // budget books often in £000s
            grossBudget: gross ? gross * 1000 : null,
          });
        }
      }
    }
  }

  return results;
}

function extractOutturnData(text: string): OutturnLine[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: OutturnLine[] = [];
  let currentDirectorate = "";
  let inOutturnSection = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("outturn") ||
      lower.includes("actual") ||
      lower.includes("expenditure and income")
    ) {
      inOutturnSection = true;
    }

    const matchedDir = DIRECTORATES.find((d) =>
      lower.includes(d.toLowerCase())
    );
    if (matchedDir) {
      currentDirectorate = matchedDir;
    }

    if (!inOutturnSection || !currentDirectorate) continue;

    const amounts = line.match(/-?[\d,]+\.?\d*/g);
    if (amounts && amounts.length >= 2) {
      const firstAmountIdx = line.search(/-?[\d,]+\.?\d*/);
      const serviceText = line.slice(0, firstAmountIdx).trim();

      if (serviceText && serviceText.length > 2 && serviceText.length < 80) {
        const parsedAmounts = amounts.map((a) => parseAmount(a)).filter((a) => a !== null);
        if (parsedAmounts.length >= 2) {
          const outturn = parsedAmounts[0]! * 1000;
          const variance = parsedAmounts[parsedAmounts.length - 1]! * 1000;

          results.push({
            directorate: currentDirectorate,
            service: serviceText,
            netOutturn: outturn,
            variance,
          });
        }
      }
    }
  }

  return results;
}

async function main() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  const council = db
    .select()
    .from(schema.councils)
    .where(eq(schema.councils.slug, "kirklees"))
    .get();

  if (!council) {
    console.error("Kirklees council not found in DB. Run ingest.ts first.");
    process.exit(1);
  }

  const councilId = council.id;

  // Clear existing budget/outturn data
  sqlite.exec("DELETE FROM budgets");
  sqlite.exec("DELETE FROM outturns");

  // Process budget PDFs
  const budgetFiles = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".pdf") && (f.includes("budget") || f.includes("summary")));

  const accountFiles = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".pdf") && f.includes("statement-of-accounts"));

  // Helper to get/create financial year
  function getOrCreateFY(label: string): number {
    const existing = db
      .select()
      .from(schema.financialYears)
      .where(
        and(
          eq(schema.financialYears.councilId, councilId),
          eq(schema.financialYears.label, label)
        )
      )
      .get();

    if (existing) return existing.id;

    const parts = label.split("-");
    const startYear = parseInt(parts[0]);
    db.insert(schema.financialYears)
      .values({
        councilId,
        label,
        startDate: `${startYear}-04-01`,
        endDate: `${startYear + 1}-03-31`,
      })
      .run();

    return db
      .select()
      .from(schema.financialYears)
      .where(
        and(
          eq(schema.financialYears.councilId, councilId),
          eq(schema.financialYears.label, label)
        )
      )
      .get()!.id;
  }

  // Ingest budget PDFs
  for (const file of budgetFiles) {
    console.log(`Processing budget PDF: ${file}`);
    const filePath = path.join(RAW_DIR, file);
    const buf = fs.readFileSync(filePath);

    try {
      const pdfData = await pdf(buf);
      const budgetLines = extractBudgetData(pdfData.text);

      // Extract FY from filename: "2025-26-summary-budget-book.pdf" → "2025-26"
      const fyMatch = file.match(/(\d{4}-\d{2})/);
      const fyLabel = fyMatch ? fyMatch[1] : "";

      if (!fyLabel) {
        console.log(`  Could not determine FY from filename: ${file}`);
        continue;
      }

      const fyId = getOrCreateFY(fyLabel);

      // Create source document
      db.insert(schema.sourceDocuments)
        .values({
          councilId,
          financialYearId: fyId,
          filename: file,
          url: `https://www.kirklees.gov.uk/beta/delivering-services/pdf/${file}`,
          type: "budget",
          downloadedAt: new Date().toISOString(),
        })
        .run();

      let inserted = 0;
      for (const line of budgetLines) {
        db.insert(schema.budgets)
          .values({
            financialYearId: fyId,
            directorate: line.directorate,
            service: line.service,
            netBudget: line.netBudget,
            grossBudget: line.grossBudget,
          })
          .run();
        inserted++;
      }
      console.log(`  Inserted ${inserted} budget lines for ${fyLabel}`);
    } catch (err) {
      console.error(`  Failed to parse ${file}:`, err);
    }
  }

  // Ingest statement of accounts (for outturn data)
  for (const file of accountFiles) {
    console.log(`Processing accounts PDF: ${file}`);
    const filePath = path.join(RAW_DIR, file);
    const buf = fs.readFileSync(filePath);

    try {
      const pdfData = await pdf(buf);
      const outturnLines = extractOutturnData(pdfData.text);

      // Extract FY: "statement-of-accounts-2024-25.pdf" → "2024-25"
      const fyMatch = file.match(/(\d{4}-\d{2})/);
      const fyLabel = fyMatch ? fyMatch[1] : "";

      if (!fyLabel) {
        console.log(`  Could not determine FY from filename: ${file}`);
        continue;
      }

      const fyId = getOrCreateFY(fyLabel);

      db.insert(schema.sourceDocuments)
        .values({
          councilId,
          financialYearId: fyId,
          filename: file,
          url: `https://www.kirklees.gov.uk/beta/delivering-services/pdf/${file}`,
          type: "accounts",
          downloadedAt: new Date().toISOString(),
        })
        .run();

      let inserted = 0;
      for (const line of outturnLines) {
        db.insert(schema.outturns)
          .values({
            financialYearId: fyId,
            directorate: line.directorate,
            service: line.service,
            netOutturn: line.netOutturn,
            variance: line.variance,
          })
          .run();
        inserted++;
      }
      console.log(`  Inserted ${inserted} outturn lines for ${fyLabel}`);
    } catch (err) {
      console.error(`  Failed to parse ${file}:`, err);
    }
  }

  sqlite.close();
  console.log("\nBudget/outturn ingestion complete.");
}

main().catch((err) => {
  console.error("Budget ingestion failed:", err);
  process.exit(1);
});
