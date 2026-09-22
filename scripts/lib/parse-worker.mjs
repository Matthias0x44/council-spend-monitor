import { tsImport } from 'tsx/esm/api';
const ingestModule = await tsImport('./ingest.ts', import.meta.url);
const { ingestFile } = ingestModule.default || ingestModule;
const schemaModule = await tsImport('../../src/db/schema.ts', import.meta.url);
const schema = schemaModule.default || schemaModule;
const {default:Database}=await import('better-sqlite3');
const {drizzle}=await import('drizzle-orm/better-sqlite3');
const {default:fs}=await import('node:fs');
process.once('message',input=>{
 const sqlite=new Database(':memory:');
 let result;
 try {
  sqlite.exec(fs.readFileSync('scripts/d1/schema.sql','utf8'));
  sqlite.prepare('INSERT INTO councils(id,name,slug) VALUES(1,?,?)').run(input.name,input.slug);
  const parsed=ingestFile({councilId:1,councilSlug:input.slug,filePath:input.filePath,fileUrl:input.fileUrl,scrapeProfile:input.profile,db:drizzle(sqlite,{schema}),sqlite});
  const data=sqlite.prepare(`SELECT s.name supplier_name,s.normalised_name supplier_norm,f.label fy_label,t.service,t.directorate,t.category,t.description,t.amount,t.date,t.month,t.service_classification,t.classification_method,t.classification_evidence,t.classifier_version FROM transactions t JOIN suppliers s ON s.id=t.supplier_id JOIN financial_years f ON f.id=t.financial_year_id`).all();
  result={parsed,data};
 } finally {sqlite.close();}
 process.send(result,()=>process.disconnect());
});
