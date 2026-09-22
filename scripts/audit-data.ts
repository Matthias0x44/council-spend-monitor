/** Reproducible quality receipt; no inferred months or synthetic transactions. */
import Database from "better-sqlite3";
import fs from "node:fs";
import { fiscalWindow } from "../src/lib/fiscal";
const db = new Database(process.env.LOCAL_DB_PATH || "data/council-spend.db",{readonly:true});
const w=fiscalWindow();
const registry=JSON.parse(fs.readFileSync("data/england-registry.json","utf8")) as {authorities:{slug:string;name:string;startDate:string;endDate:string}[]};
const profile=db.prepare(`SELECT COUNT(*) transactions, COUNT(DISTINCT council_id) councilsWithData, MIN(month) firstMonth, MAX(month) lastMonth, ROUND(SUM(amount),2) netPayments, SUM(amount<0) credits, SUM(date IS NULL OR date='') monthOnlyDates, SUM(classification_method='rule') ruleClassified, SUM(classification_method='unresolved') unclassified FROM transactions`).get();
const invalid=db.prepare("SELECT COUNT(*) n FROM transactions WHERE month IS NULL OR month='' OR month < ? OR month >= ? OR date > ?").get(w.start.slice(0,7),w.endExclusive.slice(0,7),w.through) as {n:number};
const integrity=db.pragma("foreign_key_check");
const periodErrors=db.prepare(`SELECT COUNT(*) n FROM transactions t LEFT JOIN financial_years f ON f.id=t.financial_year_id WHERE f.id IS NULL OR f.council_id<>t.council_id OR t.month < substr(f.start_date,1,7) OR t.month > substr(f.end_date,1,7)`).get() as {n:number};
const lineageErrors=db.prepare(`SELECT COUNT(*) n FROM transactions t LEFT JOIN source_documents s ON s.id=t.source_document_id LEFT JOIN suppliers p ON p.id=t.supplier_id WHERE s.id IS NULL OR s.council_id<>t.council_id OR p.id IS NULL OR p.council_id<>t.council_id OR s.url NOT LIKE 'http%'`).get() as {n:number};
const duplicateFiles=db.prepare("SELECT council_id,content_hash,COUNT(*) n FROM source_documents WHERE content_hash IS NOT NULL GROUP BY council_id,content_hash HAVING COUNT(*)>1").all();
const observations=db.prepare(`SELECT c.slug, t.month, COUNT(*) rows, ROUND(SUM(t.amount),2) netPayments FROM transactions t JOIN councils c ON c.id=t.council_id GROUP BY c.slug,t.month`).all() as {slug:string;month:string;rows:number;netPayments:number}[];
const lookup=new Map(observations.map(r=>[`${r.slug}:${r.month}`,r]));
const coverage=registry.authorities.map(a=>{
 const months=[];
 for(let month=w.start.slice(0,7);month<=w.through.slice(0,7);){
  const applicable=(!a.startDate || month>=a.startDate.slice(0,7)) && (!a.endDate || month<=a.endDate.slice(0,7));
  const observed=lookup.get(`${a.slug}:${month}`);
  months.push({month,status:!applicable?"not_applicable":observed?"observed_unverified":"missing",rows:observed?.rows || 0,netPayments:observed?.netPayments ?? null});
  const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);month=d.toISOString().slice(0,7);
 }
 return {...a,months};
});
const classifications=db.prepare("SELECT service_classification label, classification_method method, COUNT(*) rows FROM transactions GROUP BY 1,2 ORDER BY rows DESC").all();
const report={generatedAt:new Date().toISOString(),window:w,profile,invalidDates:invalid.n,financialYearErrors:periodErrors.n,lineageErrors:lineageErrors.n,foreignKeyErrors:integrity,duplicateFiles,classifications,coverage,notes:["Observed months do not establish completeness.","Current year is partial; predecessor authorities remain separately identified.","Classifier rules are not calibrated probabilities; accuracy needs independent reviewed labels.","Published transactions are not total council expenditure."]};
fs.mkdirSync("data/reports",{recursive:true});fs.writeFileSync("data/reports/quality.json",JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,coverage:`${coverage.length} authority coverage matrices in data/reports/quality.json`},null,2));
db.close();
if(invalid.n || periodErrors.n || lineageErrors.n || (integrity as unknown[]).length || duplicateFiles.length) process.exitCode=1;
