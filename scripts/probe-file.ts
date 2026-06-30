/**
 * Throwaway helper: run column detection on a single spreadsheet and
 * print the mapping plus a few sample rows. Lets us iterate on the
 * mapper / encoding without re-running the full pipeline.
 *
 * Usage:
 *   npx tsx scripts/probe-file.ts data/raw/stockport/All+Spend+April+2025.csv
 */

import * as fs from "fs";
import * as XLSX from "xlsx";
import { detectColumns, applyMapping, validateSupplierColumn } from "./lib/column-mapper";

function looksLikeCp1252(buf: Buffer): boolean {
  let highBytes = 0;
  let invalidUtf8 = 0;
  const limit = Math.min(buf.length, 64 * 1024);
  for (let i = 0; i < limit; i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    highBytes++;
    if (b >= 0xc2 && b <= 0xf4) {
      const next = buf[i + 1];
      if (next === undefined || next < 0x80 || next > 0xbf) invalidUtf8++;
      else i++;
    } else {
      invalidUtf8++;
    }
  }
  return highBytes > 0 && invalidUtf8 / Math.max(1, highBytes) > 0.5;
}

function readRows(filePath: string): Record<string, unknown>[] {
  const buf = fs.readFileSync(filePath);
  const isCsv = filePath.toLowerCase().endsWith(".csv");
  if (isCsv && looksLikeCp1252(buf)) {
    const decoder = new TextDecoder("windows-1252");
    const text = decoder.decode(buf);
    const wb = XLSX.read(text, { type: "string", raw: false });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  }
  const wb = XLSX.read(buf, { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx scripts/probe-file.ts <path>");
    process.exit(1);
  }

  const rows = readRows(filePath);
  if (rows.length === 0) {
    console.log("File has no rows.");
    return;
  }

  console.log(`\nFile: ${filePath}`);
  console.log(`Rows: ${rows.length.toLocaleString()}`);
  console.log(`Headers (${Object.keys(rows[0]).length}):`);
  for (const h of Object.keys(rows[0])) console.log(`  - ${JSON.stringify(h)}`);

  const headers = Object.keys(rows[0]);
  const detection = detectColumns(headers);
  console.log(`\nDetected mapping:`);
  console.log(JSON.stringify(detection.mapping, null, 2));
  console.log(`Missing required: ${detection.missingRequired.join(", ") || "-"}`);

  const validated = validateSupplierColumn(detection.mapping, rows, headers);
  if (validated.warning) console.log(`Validator: ${validated.warning}`);

  console.log(`\nSample rows (raw ? mapped):`);
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const mapped = applyMapping(rows[i], validated.mapping);
    console.log(`  ${i}: amount=${JSON.stringify(mapped.amount)} supplier=${JSON.stringify(mapped.supplier)} date=${JSON.stringify(mapped.date)}`);
  }

  let countAmtZero = 0;
  let countAmtNum = 0;
  let countAmtStrNumeric = 0;
  let countAbove500 = 0;
  let countBelow500 = 0;
  for (const r of rows) {
    const mapped = applyMapping(r, validated.mapping);
    let amount = 0;
    if (typeof mapped.amount === "number") {
      amount = mapped.amount;
      countAmtNum++;
    } else if (typeof mapped.amount === "string") {
      const parsed = parseFloat(String(mapped.amount).replace(/[\u00A3,]/g, ""));
      if (!isNaN(parsed)) {
        amount = parsed;
        countAmtStrNumeric++;
      }
    }
    if (amount === 0) countAmtZero++;
    else if (Math.abs(amount) >= 500) countAbove500++;
    else countBelow500++;
  }
  console.log(`\nAmounts: zero=${countAmtZero} numeric=${countAmtNum} stringNumeric=${countAmtStrNumeric}`);
  console.log(`Filter:  >=500=${countAbove500} <500=${countBelow500}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
