/** Seed the official English council universe; source adapters enrich only exact matches. */
import fs from "node:fs";
import Database from "better-sqlite3";
import * as XLSX from "xlsx";
import { MANUAL_COUNCILS } from "./seed-registry";
import { fiscalWindow } from "../src/lib/fiscal";
import { migrate } from "./lib/migrate";
const source = "https://raw.githubusercontent.com/digital-land/dluhc-datasets/main/data/registers/local-authority.csv";
const sourceFile = "data/english-authorities-source.csv";
const normalize = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/city of|royal borough of|london borough of|metropolitan|borough|district|county|city|council/g, "").replace(/[^a-z0-9]/g, "");
const slugify = (s: string) => s.toLowerCase().replace(/\b(council|district|county|borough|metropolitan)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
async function main() {
  fs.mkdirSync("data", { recursive: true });
  if (process.argv.includes("--refresh") || !fs.existsSync(sourceFile)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Authority register: HTTP ${response.status}`);
    fs.writeFileSync(sourceFile, await response.text());
  }
  const workbook = XLSX.read(fs.readFileSync(sourceFile), { type: "buffer", raw: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  const window = fiscalWindow();
  const eligible = rows.filter(r => ["NMD", "UA", "MD", "LBO", "CTY", "CC"].includes(r["local-authority-type"]) && (!r["end-date"] || r["end-date"] >= window.start) && (!r["start-date"] || r["start-date"] <= window.through));
  if (eligible.length < 300) throw new Error("Authority register unexpectedly small; refusing to seed");
  const db = new Database(process.env.LOCAL_DB_PATH || "data/council-spend.db");
  db.exec(fs.readFileSync("scripts/d1/schema.sql", "utf8")); migrate(db);
  db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
  const existing = db.prepare("SELECT id, name, slug FROM councils").all() as { id: number; name: string; slug: string }[];
  const adapters = JSON.parse(fs.readFileSync("data/source-adapters.json", "utf8")) as Record<string, { transparencyUrl?: string; dataGovId?: string }>;
  const registry = eligible.map(r => {
    const manual = MANUAL_COUNCILS.find(m => normalize(m.name) === normalize(r.name));
    const prior = existing.find(c => normalize(c.name) === normalize(r.name));
    const baseSlug = prior?.slug || manual?.slug || slugify(r.name);
    const successor = r["end-date"] && eligible.some(other => !other["end-date"] && normalize(other.name) === normalize(r.name));
    const slug = successor ? `${baseSlug}-${r.reference.toLowerCase()}` : baseSlug;
    db.prepare(`INSERT INTO councils(name,slug,region,transparency_url,data_gov_id,scrape_status) VALUES(?,?,?,?,?,'pending') ON CONFLICT(slug) DO UPDATE SET name=excluded.name, transparency_url=COALESCE(councils.transparency_url,excluded.transparency_url), data_gov_id=COALESCE(councils.data_gov_id,excluded.data_gov_id)`).run(r.name,slug,manual?.region || r.region || null,adapters[slug]?.transparencyUrl || manual?.transparencyUrl || null,adapters[slug]?.dataGovId || manual?.dataGovId || null);
    const councilId = (db.prepare("SELECT id FROM councils WHERE slug=?").get(slug) as {id:number}).id;
    db.prepare("INSERT INTO english_authorities(reference,council_id,name,start_date,end_date,website) VALUES(?,?,?,?,?,?) ON CONFLICT(reference) DO UPDATE SET council_id=excluded.council_id,name=excluded.name,start_date=excluded.start_date,end_date=excluded.end_date,website=excluded.website").run(r.reference,councilId,r.name,r["start-date"]||null,r["end-date"]||null,r.website);
    return { slug, name:r.name, reference:r.reference, gssCode:r["statistical-geography"], type:r["local-authority-type"], startDate:r["start-date"], endDate:r["end-date"], website:r.website };
  });
  fs.writeFileSync("data/england-registry.json", JSON.stringify({ source, retrievedAt: new Date().toISOString(), window, authorities:registry },null,2));
  console.log(`${registry.length} English authorities overlap the retained window; ${registry.filter(r => !r.endDate || r.endDate >= window.through).length} currently operating.`);
  db.close();
}
main().catch(e => { console.error(e); process.exitCode=1; });
