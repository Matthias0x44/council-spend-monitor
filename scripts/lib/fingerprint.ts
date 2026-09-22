import { createHash } from "node:crypto";
export interface FingerprintRow { supplierId: number | null; amount: number; date: string | null; month: string | null; service: string | null; directorate: string | null; category: string | null; description: string | null; }
/** Multiset identity: source order and format do not matter, repeated lines do. */
export function documentFingerprint(rows: FingerprintRow[]): string {
 const hashes=rows.map(r=>createHash("sha256").update(JSON.stringify([r.supplierId,Math.round(r.amount*100),r.date,r.month,...[r.service,r.directorate,r.category,r.description].map(s=>(s||"").normalize("NFKC").trim().replace(/\s+/g," "))])).digest("hex"));
 return createHash("sha256").update(hashes.sort().join("\n")).digest("hex");
}
