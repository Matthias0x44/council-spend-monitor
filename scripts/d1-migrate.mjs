/** Additive migration only: existing readers continue to work. */
import fs from 'node:fs';
import {rows,query,bookmark,literal} from './lib/d1-client.mjs';
const report=JSON.parse(fs.readFileSync('data/reports/d1-quality.json','utf8'));
const additions={source_documents:{content_hash:'TEXT',semantic_hash:'TEXT'},transactions:{service_classification:"TEXT NOT NULL DEFAULT 'Unclassified'",classification_method:"TEXT NOT NULL DEFAULT 'unresolved'",classification_evidence:'TEXT',classifier_version:'TEXT'}};
console.log(await bookmark('d1-before-migration'));
for(const [table,columns] of Object.entries(additions)){
 const existing=new Set((await rows(`PRAGMA table_info(${table})`)).map(c=>c.name));
 for(const [column,type] of Object.entries(columns))if(!existing.has(column))await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
await query(`CREATE INDEX IF NOT EXISTS source_content_idx ON source_documents(council_id,content_hash); CREATE INDEX IF NOT EXISTS source_semantic_idx ON source_documents(council_id,semantic_hash); CREATE TABLE IF NOT EXISTS english_authorities(reference TEXT PRIMARY KEY,council_id INTEGER NOT NULL UNIQUE REFERENCES councils(id),name TEXT NOT NULL,start_date TEXT,end_date TEXT,website TEXT); CREATE TABLE IF NOT EXISTS ingest_staging(import_id TEXT NOT NULL,row_no INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(import_id,row_no)); CREATE TABLE IF NOT EXISTS ingest_receipts(import_id TEXT PRIMARY KEY,council_id INTEGER NOT NULL,url TEXT NOT NULL,content_hash TEXT,semantic_hash TEXT,rows INTEGER NOT NULL,committed_at TEXT NOT NULL);`);
const adapters=JSON.parse(fs.readFileSync('data/source-adapters.json','utf8'));
for(const authority of report.registry){
 const normalize=s=>s.toLowerCase().replace(/&/g,'and').replace(/city of|royal borough of|london borough of|metropolitan|borough|district|county|city|council/g,'').replace(/[^a-z0-9]/g,'');
 const successor=authority.endDate && report.registry.some(a=>!a.endDate && normalize(a.name)===normalize(authority.name));
 if(successor){authority.slug=authority.slug+'-'+authority.reference.toLowerCase();authority.candidates=[];}
 else for(const extra of report.outsideEngland)if(normalize(extra.name)===normalize(authority.name))authority.candidates.push(extra);
 const candidates=authority.candidates.sort((a,b)=>b.rows-a.rows||a.id-b.id);
 let councilId=candidates[0]?.id;
 if(!councilId){
  const adapter=adapters[authority.slug]||{};
  const result=await rows('INSERT INTO councils(name,slug,transparency_url,data_gov_id,scrape_status) VALUES(?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name RETURNING id',[authority.name,authority.slug,adapter.transparencyUrl||null,adapter.dataGovId||null,'pending']);councilId=result[0].id;
 }
 await query(`INSERT INTO english_authorities(reference,council_id,name,start_date,end_date,website) VALUES(${[authority.reference,councilId,authority.name,authority.startDate||null,authority.endDate||null,authority.website].map(literal).join(',')}) ON CONFLICT(reference) DO UPDATE SET council_id=excluded.council_id,name=excluded.name,start_date=excluded.start_date,end_date=excluded.end_date,website=excluded.website`);
}
console.log('Migrated schema and registered',report.registry.length,'English authorities');

await import("./d1-period-migrate.mjs");
