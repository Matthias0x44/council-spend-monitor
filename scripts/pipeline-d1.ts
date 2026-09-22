/** Direct D1 importer. One temporary spreadsheet/in-memory SQLite at a time.
 * Rows stage remotely; a single atomic batch swaps a source only after validation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { monthFingerprints } from "./lib/month-fingerprints";
import { parseIsolated, type ParsedRow as Row } from "./lib/parse-isolated";
import { discoverFiles, downloadFile, isPaymentPublication, type DiscoveredFile } from "./lib/discover";
import { monthFromFilename, PARSER_VERSION } from "./lib/parse";
import { fiscalWindow } from "../src/lib/fiscal";
import { CLASSIFIER_VERSION } from "../src/lib/classifier";
import { rows, query, bookmark, literal, d1Request } from "./lib/d1-client.mjs";
type Council={id:number;slug:string;name:string;transparency_url:string|null;data_gov_id:string|null;scrape_profile:string|null;file_pattern:string|null;reference:string};
const args=process.argv.slice(2),value=(key:string)=>args[args.indexOf(key)+1];
const window=fiscalWindow();
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;console.log('Finishing current source before stopping');});
process.on('SIGINT',()=>{stopping=true;console.log('Finishing current source before stopping');});
const adapters=JSON.parse(fs.readFileSync("data/source-adapters.json","utf8")) as Record<string,{transparencyUrl?:string;dataGovId?:string;packages?:string[]}>;
const registry=JSON.parse(fs.readFileSync("data/england-registry.json","utf8")) as {authorities:{reference:string;slug:string}[]};
async function upload(council:Council,file:DiscoveredFile,dir:string){
 const local=await downloadFile(file.url,dir,file.filename,true);
 try{
 const bytes=fs.readFileSync(local),contentHash=createHash('sha256').update(bytes).digest('hex');
 const existing=await rows(`SELECT d.id FROM source_documents d WHERE council_id=? AND url=? AND content_hash=? AND substr(downloaded_at,1,10)=? AND json_extract(column_mapping,'$.parserVersion')=? AND NOT EXISTS(SELECT 1 FROM transactions t WHERE t.source_document_id=d.id AND COALESCE(t.classifier_version,'')<>?)`,[council.id,file.url,contentHash,window.through,PARSER_VERSION,CLASSIFIER_VERSION]);
 if(existing.length && !args.includes('--force'))return {inserted:0,status:'unchanged'};
  const result=await parseIsolated({name:council.name,slug:council.slug,filePath:local,fileUrl:file.url,profile:council.scrape_profile?JSON.parse(council.scrape_profile):null});
  const {parsed}=result;let data=result.data;
  if(parsed.missingRequired.length)throw new Error(`Missing columns: ${parsed.missingRequired.join(',')}`);
  if(!parsed.inserted)return {inserted:0,status:'no_retained_rows'};
  const priorCount=await rows('SELECT COUNT(*) n FROM transactions WHERE council_id=? AND source_document_id IN(SELECT id FROM source_documents WHERE council_id=? AND url=?) AND month>=? AND month<=?',[council.id,council.id,file.url,window.start.slice(0,7),window.through.slice(0,7)]);
  if(priorCount[0].n>100 && parsed.inserted<priorCount[0].n*0.8)throw new Error(`Row-count regression: ${priorCount[0].n} retained rows to ${parsed.inserted}; requires source review`);
  // Same rows in CSV and XLSX hash identically; preserve repeated payment lines.
  let semanticHash=createHash('sha256').update(data.map(r=>JSON.stringify([r.supplier_norm,r.fy_label,r.service,r.directorate,r.category,r.description,r.amount,r.date,r.month])).sort().join('\n')).digest('hex');
  if((await rows('SELECT id FROM source_documents WHERE council_id=? AND semantic_hash=? AND url<>?',[council.id,semanticHash,file.url])).length){
    // Older runs may already have imported the duplicate format. Remove only
    // this verified equivalent URL, preserving the source with the same multiset.
    const u=literal(file.url);
    await query(`DELETE FROM transactions WHERE council_id=${council.id} AND source_document_id IN(SELECT id FROM source_documents WHERE council_id=${council.id} AND url=${u}); DELETE FROM source_documents WHERE council_id=${council.id} AND url=${u}`);
    return {inserted:0,status:'duplicate_format'};
  }
  const periods=monthFingerprints(data);
  const priorPeriods=await rows('SELECT p.month,p.hash FROM source_month_fingerprints p JOIN source_documents d ON d.id=p.source_document_id WHERE p.council_id=? AND d.url<>?',[council.id,file.url]) as {month:string;hash:string}[];
  const duplicateMonths=new Set(periods.filter(p=>priorPeriods.some(old=>old.month===p.month&&old.hash===p.hash)).map(p=>p.month));
  if(duplicateMonths.size){
   data=data.filter(row=>!duplicateMonths.has(row.month));
   if(!data.length){
    const u=literal(file.url);
    await query(`DELETE FROM transactions WHERE council_id=${council.id} AND source_document_id IN(SELECT id FROM source_documents WHERE council_id=${council.id} AND url=${u}); DELETE FROM source_documents WHERE council_id=${council.id} AND url=${u}`);
    return {inserted:0,status:'duplicate_months',duplicateMonths:[...duplicateMonths]};
   }
   semanticHash=createHash('sha256').update(data.map(r=>JSON.stringify([r.supplier_norm,r.fy_label,r.service,r.directorate,r.category,r.description,r.amount,r.date,r.month])).sort().join('\n')).digest('hex');
  }
  const importId=createHash('sha256').update(`${council.id}:${file.url}:${contentHash}:${window.start}:${window.through}:${PARSER_VERSION}:${CLASSIFIER_VERSION}`).digest('hex');
  if((await rows('SELECT import_id FROM ingest_receipts WHERE import_id=?',[importId])).length&&!args.includes('--force'))return {inserted:0,status:'already_committed'};
  await query('DELETE FROM ingest_staging WHERE import_id=?',[importId]);
  // json_each keeps SQL short and uses a bounded JSON parameter, avoiding one
  // HTTP request per tiny INSERT while remaining below D1's value-size limit.
  let chunk: Row[] = [], size = 0, offset = 0;
  const flush=async()=>{if(chunk.length){await query("INSERT OR REPLACE INTO ingest_staging(import_id,row_no,payload) SELECT ?,CAST(key AS INTEGER)+?,value FROM json_each(?)",[importId,offset,JSON.stringify(chunk)]);offset+=chunk.length;chunk=[];size=0;}};
  for(const row of data){const bytes=Buffer.byteLength(JSON.stringify(row));if(size+bytes>600000)await flush();chunk.push(row);size+=bytes;}
  await flush();
  const staged=await rows('SELECT COUNT(*) n FROM ingest_staging WHERE import_id=?',[importId]);
  if(staged[0].n!==data.length)throw new Error('Incomplete remote staging');
  const id=literal(importId),url=literal(file.url),cid=council.id;
  const json=(field:string)=>`json_extract(payload,'$.${field}')`;
  const batch:string[]=[];
  // A retry reuses remote identities and replaces only this URL's transactions.
  batch.push(`INSERT INTO suppliers(council_id,name,normalised_name) SELECT ${cid},MIN(${json('supplier_name')}),${json('supplier_norm')} FROM ingest_staging WHERE import_id=${id} AND NOT EXISTS(SELECT 1 FROM suppliers WHERE council_id=${cid} AND normalised_name=${json('supplier_norm')}) GROUP BY ${json('supplier_norm')}`);
  for(const fy of new Set(data.map(r=>r.fy_label))){const y=Number(fy.slice(0,4));batch.push(`INSERT INTO financial_years(council_id,label,start_date,end_date) SELECT ${cid},${literal(fy)},'${y}-04-01','${y+1}-03-31' WHERE NOT EXISTS(SELECT 1 FROM financial_years WHERE council_id=${cid} AND label=${literal(fy)})`);}
  batch.push(`DELETE FROM transactions WHERE council_id=${cid} AND source_document_id IN(SELECT id FROM source_documents WHERE council_id=${cid} AND url=${url})`);
  batch.push(`DELETE FROM source_documents WHERE council_id=${cid} AND url=${url}`);
  batch.push(`INSERT INTO source_documents(council_id,filename,url,type,downloaded_at,column_mapping,content_hash,semantic_hash) VALUES(${cid},${literal(file.filename)},${url},'expenditure',${literal(new Date().toISOString())},${literal(JSON.stringify({parserVersion:PARSER_VERSION,sheets:parsed.sourceMappings,columns:parsed.columnMapping}))},${literal(contentHash)},${literal(semanticHash)})`);
  const fields=['service','directorate','category','description','amount','date','month','service_classification','classification_method','classification_evidence','classifier_version'];
  batch.push(`INSERT INTO transactions(council_id,financial_year_id,supplier_id,source_document_id,${fields.join(',')}) SELECT ${cid},(SELECT MIN(id) FROM financial_years WHERE council_id=${cid} AND label=${json('fy_label')}),(SELECT MIN(id) FROM suppliers WHERE council_id=${cid} AND normalised_name=${json('supplier_norm')}),(SELECT MAX(id) FROM source_documents WHERE council_id=${cid} AND url=${url}),${fields.map(json).join(',')} FROM ingest_staging WHERE import_id=${id}`);
  for(const period of periods.filter(p=>!duplicateMonths.has(p.month))){
   batch.push(`INSERT INTO source_month_fingerprints(council_id,source_document_id,month,hash,rows) SELECT ${cid},MAX(id),${literal(period.month)},${literal(period.hash)},${period.rows} FROM source_documents WHERE council_id=${cid} AND url=${url}`);
  }
  batch.push(`INSERT OR REPLACE INTO ingest_receipts(import_id,council_id,url,content_hash,semantic_hash,rows,committed_at) VALUES(${id},${cid},${url},${literal(contentHash)},${literal(semanticHash)},${data.length},${literal(new Date().toISOString())})`);
  batch.push(`DELETE FROM ingest_staging WHERE import_id=${id}`);
  await query(batch.join(';'));
  return {inserted:data.length,status:'committed',duplicateMonths:[...duplicateMonths]};
 } finally {fs.rmSync(local,{force:true});}
}
async function main(){
 const metadata=await d1Request('');if(metadata.file_size>8.5e9)throw new Error('D1 exceeds 8.5 GB operational limit; shard before further ingestion');
 await bookmark('d1-before-backfill');
 let councils=await rows('SELECT c.*,a.reference FROM councils c JOIN english_authorities a ON a.council_id=c.id') as Council[];
 if(args.includes('--slug'))councils=councils.filter(c=>c.slug===value('--slug'));
 const knownSlugs=args.includes('--slugs')?value('--slugs').split(','):null;
 if(knownSlugs)councils=councils.filter(c=>knownSlugs.includes(c.slug));
 if(args.includes('--exclude-slugs')){const excluded=value('--exclude-slugs').split(',');councils=councils.filter(c=>!excluded.includes(c.slug));}
 if(!councils.length)throw new Error('No matching registered English authorities');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'council-d1-'));
 const report:{council:string;url?:string;inserted?:number;status?:string;error?:string}[]=[];
 const startedAt=new Date().toISOString();
 const save=()=>fs.writeFileSync('data/reports/d1-backfill.json',JSON.stringify({startedAt,generatedAt:new Date().toISOString(),window,classifierVersion:CLASSIFIER_VERSION,interrupted:stopping,results:report},null,2));
 try{
  for(const council of councils){
   if(stopping)break;
   console.log(`Processing ${council.slug}`);
   const official=registry.authorities.find(a=>a.reference===council.reference);
   const adapter=adapters[official?.slug || council.slug] || {};
   const currentMeta=await d1Request('');if(currentMeta.file_size>8.5e9)throw new Error('D1 storage guard reached; shard before continuing');
   const sources=await rows('SELECT url,filename FROM source_documents WHERE council_id=?',[council.id]) as {url:string;filename:string}[];
   let files:DiscoveredFile[]=sources.filter(s=>/^https?:/.test(s.url)).map(s=>({...s,format:path.extname(s.filename).slice(1)||'csv'}));
   try{files.push(...await discoverFiles({slug:council.slug,name:council.name,transparencyUrl:adapter.transparencyUrl||council.transparency_url,dataGovId:adapter.dataGovId||council.data_gov_id,filePattern:council.file_pattern}));}
   catch(error){report.push({council:council.slug,error:String(error)});}
   for(const pkg of adapter.packages||[])try{files.push(...await discoverFiles({slug:council.slug,name:council.name,dataGovId:pkg}));}catch(error){report.push({council:council.slug,error:String(error)});}
   files=[...new Map(files.filter(f=>{if(!isPaymentPublication(`${f.filename} ${f.url}`))return false;const m=monthFromFilename(f.filename);return !m||m>=window.start.slice(0,7);}).map(f=>[f.url,f])).values()];
   if(!files.length)report.push({council:council.slug,error:'No published source files discovered'});
   if(args.includes('--max-files'))files=files.slice(0,Number(value('--max-files')));
   for(const file of files){
    if(stopping)break;
    // Leave headroom even when a single council has many large publications.
    const meta=await d1Request('');if(meta.file_size>8.5e9)throw new Error('D1 storage guard reached; shard before continuing');
    console.log(new Date().toISOString(),council.slug,"Reading",file.filename);try{const result=await upload(council,file,dir);report.push({council:council.slug,url:file.url,...result});console.log(council.slug,file.filename,result);}catch(error){report.push({council:council.slug,url:file.url,error:String(error)});console.error(council.slug,file.filename,String(error));}
    save();
   }
   save();
  }
 }finally{save();fs.rmSync(dir,{recursive:true,force:true});}
 if(stopping||report.some(r=>r.error))process.exitCode=2;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
