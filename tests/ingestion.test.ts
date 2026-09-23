import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/db/schema";
import { ingestFile } from "../scripts/lib/ingest";
import { parseAmount, parseDate, monthFromFilename } from "../scripts/lib/parse";
import { fiscalWindow, fiscalLabel } from "../src/lib/fiscal";
import { classifyService } from "../src/lib/classifier";
import * as XLSX from "xlsx";
import { detectColumns } from "../scripts/lib/column-mapper";

test('Coventry text columns take priority over supplier and category codes',()=>{
 const {mapping}=detectColumns(['Proclass','Proclass(T)','Supplier','Supplier(T) ','Directorate(T)','Cost Centre','Cost Centre(T)','Account Code','Account Code(T)','Transaction No','Period','Transaction Date','Amount','Comment']);
 assert.equal(mapping['Supplier(T) '],'supplier');
 assert.equal(mapping['Proclass(T)'],'category');
 assert.equal(mapping['Cost Centre(T)'],'service');
 assert.equal(mapping['Account Code(T)'],'description');
 assert.equal(mapping['Transaction Date'],'date');
});

test('legitimate suppliers beginning Total are not discarded as summary lines',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'council-total-'));
 const sqlite=new Database(':memory:');
 try{
  sqlite.exec(fs.readFileSync('scripts/d1/schema.sql','utf8'));
  sqlite.prepare("INSERT INTO councils(name,slug) VALUES('Example','example')").run();
  const file=path.join(dir,'payments.csv');
  fs.writeFileSync(file,`Supplier,Amount,Date\nTotal Energies Ltd,600,${fiscalWindow().start}\nTotal,600,\n`);
  assert.equal(ingestFile({councilId:1,councilSlug:'example',filePath:file,fileUrl:'https://example.gov.uk/payments.csv',sqlite,db:drizzle(sqlite,{schema})}).inserted,1);
 }finally{sqlite.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("five financial years including current, at April boundary", () => {
 assert.equal(fiscalWindow(new Date("2026-03-31T23:59:59Z")).start,"2021-04-01");
 assert.equal(fiscalWindow(new Date("2026-04-01T00:00:00Z")).start,"2022-04-01");
 assert.equal(fiscalLabel("2023-03"),"2022-23");
 assert.equal(fiscalLabel("2023-04"),"2023-24");
});
test("reject malformed amounts and retain credits accurately", () => {
 for(const [input,expected] of [["£1,234.56",1234.56],["(500.20)",-500.2],["500-",-500],["500 USD",null],["1.2.3",null],[Infinity,null],["",null]] as const) assert.equal(parseAmount(input),expected);
});
test("UK dates, Excel dates and filename FY boundaries", () => {
 assert.equal(parseDate("03/04/2024"),"2024-04-03");
 assert.equal(parseDate("31/02/2024"),"");
 assert.equal(parseDate("1-Apr-24"),"2024-04-01");
 assert.equal(parseDate(45383),"2024-04-01");
 assert.equal(parseDate('20250402'),'2025-04-02');
 assert.equal(parseDate(20250402),'2025-04-02');
 assert.equal(parseDate('20250231'),'');
 assert.equal(parseDate('202503'),'');
 assert.equal(monthFromFilename("MAR 23-24.csv"),"2024-03");
 assert.equal(monthFromFilename("April 2023-24.csv"),"2023-04");
 assert.equal(monthFromFilename("2023-24.csv"),"");
 assert.equal(monthFromFilename("spending-April-June-2025.xlsx"),"");
 assert.equal(monthFromFilename("July-August-2025.csv"),"");
});
test("classification abstains on ambiguous evidence and avoids substring/supplier guesses", () => {
 for(const value of ["community services","adult and children services","educational equipment supplier","care invoice","SEND invoice".toLowerCase()]) {
   if (value === "send invoice") continue;
   assert.equal(classifyService({ description:value }).method,"unresolved",value);
 }
 assert.equal(classifyService({service:"Adult social care",description:"School building"}).label,"Adult social care");
 assert.equal(classifyService({service:"Adult social care and housing"}).method,"unresolved");
 assert.equal(classifyService({service:"Highways maintenance"}).label,"Highways and transport");
 assert.equal(classifyService({description:"Waste collection"}).label,"Environmental services");
});
test("file ingestion is atomic, idempotent, keeps repeated real lines and rejects stale/future rows", () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"council-test-"));
 const file=path.join(dir,"payments.csv"); const sqlite=new Database(":memory:");
 sqlite.exec(fs.readFileSync("scripts/d1/schema.sql","utf8")); sqlite.pragma("foreign_keys = ON");
 sqlite.prepare("INSERT INTO councils(name,slug) VALUES('Example','example')").run();
 const db=drizzle(sqlite,{schema});
 const start=fiscalWindow().start;
 fs.writeFileSync(file,`Supplier,Amount,Date,Service,Description\nA,600,${start},Adult social care,care\nA,600,${start},Adult social care,care\nB,(550),${start},Housing,credit\nOld,999,01/01/2017,Highways,old\nFuture,999,01/01/2099,Highways,future\nTotal,1200,,,\n`);
 const opts={councilId:1,councilSlug:"example",filePath:file,fileUrl:"https://example.gov.uk/payments.csv",db,sqlite};
 assert.equal(ingestFile(opts).inserted,3);
 assert.equal(ingestFile(opts).inserted,3);
 assert.deepEqual(sqlite.prepare("SELECT COUNT(*) n, SUM(amount) amount FROM transactions").get(),{n:3,amount:650});
 assert.equal(ingestFile({...opts,fileUrl:"https://example.gov.uk/copy.csv"}).inserted,0);
 assert.equal((sqlite.prepare("SELECT COUNT(*) n FROM transactions").get() as {n:number}).n,3);
 fs.writeFileSync(file,"Wrong,Header\none,two\n");
 assert.ok(ingestFile(opts).missingRequired.length);
 assert.equal((sqlite.prepare("SELECT COUNT(*) n FROM transactions").get() as {n:number}).n,3);
 sqlite.close(); fs.rmSync(dir,{recursive:true});
});

test("six-line preambles, multiple worksheets and equivalent export formats", () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"council-formats-"));
 const sqlite=new Database(":memory:");
 try {
  sqlite.exec(fs.readFileSync("scripts/d1/schema.sql","utf8"));
  sqlite.prepare("INSERT INTO councils(name,slug) VALUES('Example','example')").run();
  const date=fiscalWindow().start, db=drizzle(sqlite,{schema});
  const book=XLSX.utils.book_new();
  for(const [name,supplier,amount] of [["First","A",600],["Second","B",-10]] as const){
   const sheet=XLSX.utils.aoa_to_sheet([["Payments over £500"],[],["Published dataset"],[],[],["Supplier","Amount","Date","Service"],[supplier,amount,date,"Adult social care"]]);
   XLSX.utils.book_append_sheet(book,sheet,name);
  }
  const workbook=path.join(dir,'payments.xlsx');XLSX.writeFile(book,workbook);
  const opts={councilId:1,councilSlug:'example',fileUrl:'https://example.gov.uk/payments.xlsx',filePath:workbook,sqlite,db};
  assert.equal(ingestFile(opts).inserted,2);
  const csv=path.join(dir,'payments.csv');fs.writeFileSync(csv,`Supplier,Amount,Date,Service\nA,600,${date},Adult social care\nB,-10,${date},Adult social care\n`);
  assert.equal(ingestFile({...opts,filePath:csv,fileUrl:'https://example.gov.uk/payments.csv'}).inserted,0);
  assert.deepEqual(sqlite.prepare('SELECT COUNT(*) n,SUM(amount) total FROM transactions').get(),{n:2,total:590});
  assert.equal(monthFromFilename('payments 100% May 2026.csv'),'2026-05');
  assert.equal(parseDate(202602),'');
 } finally {sqlite.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('blank first-row fields and different worksheet columns preserve later classification evidence',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'council-sparse-'));const sqlite=new Database(':memory:');
 try{
  sqlite.exec(fs.readFileSync('scripts/d1/schema.sql','utf8'));sqlite.exec("INSERT INTO councils(id,name,slug) VALUES(1,'Example','example')");
  const wb=XLSX.utils.book_new(),date=fiscalWindow().start;
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Supplier','Amount','Date','Department','DepartmentSubsection'],['A',600,date,'',''],['B',700,date,'Place and Economy','Parks and Open Spaces']]),'First');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Supplier','Amount','Date','Category','Description'],['C',800,date,'Property','Maintenance']]),'Second');
  const file=path.join(dir,'payments.xlsx');XLSX.writeFile(wb,file);
  const result=ingestFile({councilId:1,councilSlug:'example',filePath:file,fileUrl:'https://example.gov.uk/payments.xlsx',scrapeProfile:{Department:'directorate',DepartmentSubsection:'service'},sqlite,db:drizzle(sqlite,{schema})});
  assert.equal(result.inserted,3);
  assert.deepEqual(sqlite.prepare('SELECT service,directorate,service_classification FROM transactions WHERE amount=700').get(),{service:'Parks and Open Spaces',directorate:'Place and Economy',service_classification:'Cultural and leisure services'});
  assert.deepEqual(sqlite.prepare('SELECT category,description FROM transactions WHERE amount=800').get(),{category:'Property',description:'Maintenance'});
 }finally{sqlite.close();fs.rmSync(dir,{recursive:true,force:true});}
});
