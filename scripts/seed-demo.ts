/** Build the offline portfolio database from a small, source-attributed fixture. */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { classifyService } from '../src/lib/classifier';

type Example = {
  council_slug:string; financial_year:string; supplier:string; amount:number;
  date:string|null; month:string; directorate:string|null; service:string|null;
  category:string|null; description:string|null; source_file:string; source_url:string;
};
type Fixture = {
  generatedAt:string;
  councils:{name:string;slug:string;region:string}[];
  transactions:Example[];
};
type Authority = {
  slug:string; reference:string; name:string; startDate:string; endDate:string; website:string;
};

const fixture=JSON.parse(fs.readFileSync('data/demo-payments.json','utf8')) as Fixture;
const registry=JSON.parse(fs.readFileSync('data/england-registry.json','utf8')) as {authorities:Authority[]};
const target=path.resolve(process.env.DEMO_DB_PATH || 'data/demo.db');
if(path.basename(target)!=='demo.db')throw new Error('Demo seed can only write a demo.db file');
fs.mkdirSync(path.dirname(target),{recursive:true});
const temporary=target+'.tmp';
fs.rmSync(temporary,{force:true});
const db=new Database(temporary);
try {
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync('scripts/d1/schema.sql','utf8'));
  const insertCouncil=db.prepare('INSERT INTO councils(name,slug,region,scrape_status) VALUES(?,?,?,?)');
  const insertAuthority=db.prepare('INSERT INTO english_authorities(reference,council_id,name,start_date,end_date,website) VALUES(?,?,?,?,?,?)');
  const insertFY=db.prepare('INSERT INTO financial_years(council_id,label,start_date,end_date) VALUES(?,?,?,?)');
  const insertSupplier=db.prepare('INSERT INTO suppliers(council_id,name,normalised_name) VALUES(?,?,?)');
  const insertSource=db.prepare("INSERT INTO source_documents(council_id,filename,url,type,downloaded_at,column_mapping) VALUES(?,?,?,'expenditure',?,?)");
  const insertPayment=db.prepare(`INSERT INTO transactions(council_id,financial_year_id,supplier_id,source_document_id,service,directorate,category,description,amount,date,month,service_classification,classification_method,classification_evidence,classifier_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const councilIds=new Map<string,number>();
  const yearIds=new Map<string,number>();
  const supplierIds=new Map<string,number>();
  const sourceIds=new Map<string,number>();
  db.transaction(()=>{
    for(const council of fixture.councils){
      const authority=registry.authorities.find(row=>row.slug===council.slug);
      if(!authority)throw new Error(`Unregistered demo council: ${council.slug}`);
      const id=Number(insertCouncil.run(council.name,council.slug,council.region,'sample').lastInsertRowid);
      councilIds.set(council.slug,id);
      insertAuthority.run(authority.reference,id,authority.name,authority.startDate||null,authority.endDate||null,authority.website||null);
      for(let start=2022;start<=2026;start++){
        const label=`${start}-${String((start+1)%100).padStart(2,'0')}`;
        const yearId=Number(insertFY.run(id,label,`${start}-04-01`,`${start+1}-03-31`).lastInsertRowid);
        yearIds.set(`${council.slug}|${label}`,yearId);
      }
    }
    for(const payment of fixture.transactions){
      const councilId=councilIds.get(payment.council_slug);
      const fyId=yearIds.get(`${payment.council_slug}|${payment.financial_year}`);
      if(!councilId||!fyId||!Number.isFinite(payment.amount)||!/^202[2-6]-(0[1-9]|1[0-2])$/.test(payment.month)||!/^https:\/\//.test(payment.source_url))throw new Error('Invalid source-attributed demo payment');
      const supplierKey=`${councilId}|${payment.supplier}`;
      let supplierId=supplierIds.get(supplierKey);
      if(!supplierId){supplierId=Number(insertSupplier.run(councilId,payment.supplier,payment.supplier.trim().toUpperCase()).lastInsertRowid);supplierIds.set(supplierKey,supplierId);}
      const sourceKey=`${councilId}|${payment.source_url}`;
      let sourceId=sourceIds.get(sourceKey);
      if(!sourceId){sourceId=Number(insertSource.run(councilId,payment.source_file,payment.source_url,fixture.generatedAt,JSON.stringify({sample:true})).lastInsertRowid);sourceIds.set(sourceKey,sourceId);}
      const classification=classifyService(payment);
      insertPayment.run(councilId,fyId,supplierId,sourceId,payment.service,payment.directorate,payment.category,payment.description,payment.amount,payment.date,payment.month,classification.label,classification.method,classification.evidence,classification.version);
    }
  })();
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  fs.renameSync(temporary,target);
  console.log(`Demo database ready: ${fixture.transactions.length} source-linked payments from ${fixture.councils.length} councils at ${target}`);
} catch(error) {
  if(db.open)db.close();
  fs.rmSync(temporary,{force:true});
  throw error;
}
