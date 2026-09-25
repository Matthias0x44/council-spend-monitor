/** RFC 4180 escaping plus spreadsheet formula neutralisation for text cells. */
export function csvCell(value: unknown): string {
 let s=value == null ? "" : String(value);
 if(typeof value !== "number" && /^[\s]*[=+\-@\t\r]/.test(s)) s="'"+s;
 return `"${s.replace(/"/g,'""')}"`;
}
export function csvLine(values: unknown[]): string { return values.map(csvCell).join(",")+"\r\n"; }
