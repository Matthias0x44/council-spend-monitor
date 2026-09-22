import * as XLSX from "xlsx";
import { validDate } from "../../src/lib/fiscal";
export const PARSER_VERSION = "payment-parser-4";
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  let s = String(value ?? "").trim().replace(/[£,\s]/g, "");
  if (/^\([\d.]+\)$/.test(s)) s = `-${s.slice(1, -1)}`;
  if (/^[\d.]+-$/.test(s)) s = `-${s.slice(0, -1)}`;
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function parseDate(value: unknown): string {
  let result = "";
  if (typeof value === "number" && value > 0 && value < 100000) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) result = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  } else {
    const s = String(value ?? "").trim();
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}.*)?$/);
    const compact = s.match(/^(20\d{2})(\d{2})(\d{2})$/);
    const uk = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}.*)?$/);
    const named = s.match(/^(\d{1,2})[ \-/]([A-Za-z]{3,9})[ \-/,]+(\d{4}|\d{2})$/);
    if (iso) result = iso[1];
    else if (compact) result = `${compact[1]}-${compact[2]}-${compact[3]}`;
    else if (uk) result = `${uk[3].length === 2 ? "20" : ""}${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
    else if (named && months.includes(named[2].slice(0, 3).toLowerCase())) result = `${named[3].length === 2 ? "20" : ""}${named[3]}-${String(months.indexOf(named[2].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  }
  return validDate(result) ? result : "";
}
export function monthFromFilename(filename: string): string {
  let s = filename.toLowerCase();
  try { s = decodeURIComponent(s); } catch { /* Literal percent signs occur in council filenames. */ }
  // A fiscal-year-only filename is a period, never evidence of an April payment.
  const nameFY = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ _-]+(20\d{2}|\d{2})[-_](\d{2})(?!\d)/);
  if (nameFY) {
    const start = Number(nameFY[2].length === 2 ? "20" + nameFY[2] : nameFY[2]);
    if ((start + 1) % 100 === Number(nameFY[3])) {
      const m = months.indexOf(nameFY[1]) + 1;
      return `${start + (m < 4 ? 1 : 0)}-${String(m).padStart(2, "0")}`;
    }
  }
  const named = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^0-9]{0,4}(20\d{2})/);
  if (named) return `${named[2]}-${String(months.indexOf(named[1]) + 1).padStart(2, "0")}`;
  const reverse = s.match(/(20\d{2})[^0-9]{0,4}(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
  if (reverse) return `${reverse[1]}-${String(months.indexOf(reverse[2]) + 1).padStart(2, "0")}`;
  const shortNamed = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_ ](\d{2})(?:\.[a-z]+|$)/);
  if (shortNamed) return `20${shortNamed[2]}-${String(months.indexOf(shortNamed[1]) + 1).padStart(2, "0")}`;
  const numeric = s.match(/(?:^|[^0-9])(20\d{2})[-_ ](0?[1-9]|1[0-2])(?:[^0-9]|$)/);
  if (numeric) return `${numeric[1]}-${numeric[2].padStart(2, "0")}`;
  return "";
}
