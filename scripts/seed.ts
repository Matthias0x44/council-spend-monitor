import { execSync } from "child_process";

const steps = [
  { name: "Scrape data from Kirklees", cmd: "npx tsx scripts/scrape.ts" },
  { name: "Ingest expenditure data", cmd: "npx tsx scripts/ingest.ts" },
  { name: "Ingest budget/outturn data", cmd: "npx tsx scripts/ingest-budgets.ts" },
];

for (const step of steps) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${step.name}`);
  console.log(`${"=".repeat(60)}\n`);
  try {
    execSync(step.cmd, { stdio: "inherit" });
  } catch (err) {
    console.error(`\nStep "${step.name}" failed. Continuing...`);
  }
}

console.log("\nSeed complete!");
