import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { fiscalWindow } from "../src/lib/fiscal";
import { csvCell } from "../src/lib/csv";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"council-api-"));
process.env.LOCAL_DB_PATH=path.join(dir,"test.db");
const db=new Database(process.env.LOCAL_DB_PATH);
db.exec(fs.readFileSync("scripts/d1/schema.sql","utf8"));
const w=fiscalWindow();
db.exec("INSERT INTO councils(id,name,slug) VALUES(1,'One','one'),(2,'Two','two'); INSERT INTO suppliers(id,council_id,name,normalised_name) VALUES(1,1,'Zulu','ZULU'),(2,1,'Alpha','ALPHA');");
db.prepare("INSERT INTO financial_years(id,council_id,label,start_date,end_date) VALUES(1,1,?,?,?)").run(w.labels[0],w.labels[0].slice(0,4)+"-04-01",String(Number(w.labels[0].slice(0,4))+1)+"-03-31");
db.prepare("INSERT INTO financial_years(id,council_id,label,start_date,end_date) VALUES(2,2,?,?,?)").run(w.labels[0],w.labels[0].slice(0,4)+"-04-01",String(Number(w.labels[0].slice(0,4))+1)+"-03-31");
db.exec("INSERT INTO english_authorities(reference,council_id,name) VALUES('ONE',1,'One'),('TWO',2,'Two')");
db.exec("INSERT INTO budgets(financial_year_id,net_budget) VALUES(1,100),(2,9999)");
const insert=db.prepare("INSERT INTO transactions(council_id,financial_year_id,supplier_id,amount,date,month,description) VALUES(1,1,?,?,?,?,?)");
const day=w.labels[0].slice(0,4)+"-04-01";
for(let i=0;i<520;i++)insert.run(i%2+1,i===0?-10:10,day,day.slice(0,7),"=example, \"quoted\"");
db.exec("INSERT INTO suppliers(id,council_id,name,normalised_name) VALUES(3,2,'REDACTED','REDACTED')");
db.prepare("INSERT INTO financial_years(id,council_id,label,start_date,end_date) VALUES(3,2,?,?,?)").run(w.labels[1],w.labels[1].slice(0,4)+"-04-01",w.labels[0].slice(0,4)+"-03-31");
for(const [supplier,amount] of [[null,250],[3,100]])db.prepare("INSERT INTO transactions(council_id,financial_year_id,supplier_id,amount,date,month,directorate,category) VALUES(2,2,?,?,?,?, 'Current service','Current category')").run(supplier,amount,day,day.slice(0,7));
const olderDay=w.labels[1].slice(0,4)+"-04-01";
db.prepare("INSERT INTO transactions(council_id,financial_year_id,amount,date,month,directorate,category) VALUES(2,3,100,?,?,'Old service','Old category')").run(olderDay,olderDay.slice(0,7));
db.exec("INSERT INTO councils(id,name,slug) VALUES(3,'Stale','stale'),(4,'Invalid','invalid'),(5,'Outside England','outside'); INSERT INTO english_authorities(reference,council_id,name) VALUES('STA',3,'Stale'),('INV',4,'Invalid'); INSERT INTO transactions(council_id,amount,date,month) VALUES(3,100,'2010-01-01','2010-01'),(4,100,'2450-04-01','2450-04'),(5,100,'2026-04-01','2026-04')");
db.close();
test("CSV text is escaped and formulas neutralised; negative amounts stay numeric",()=>{
 assert.equal(csvCell('A, "B"'),'"A, ""B"""');assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell(-500),'"-500"');
});
test("query filters, ordering, coverage and council budget isolation",async()=>{
 const {getTransactions,getOverview,getMonthlyTrend}=await import('../src/lib/queries');
 assert.equal((await getOverview(1)).budget.net,100);
 assert.equal((await getTransactions(1,{supplier:'Alpha'})).total,260);
 assert.equal((await getTransactions(1,{search:'Zulu'})).total,260);
 assert.equal((await getTransactions(1,{maxAmount:0})).total,1);
 assert.equal((await getTransactions(1,{sortBy:'supplier',sortDir:'asc'})).rows[0].supplierName,'Alpha');
 const trend=await getMonthlyTrend(1,1);assert.equal(trend[0].total,5180);if(trend.length>1)assert.equal(trend[1].total,null);
});
test("API validates filters and unavailable years; export includes more than a page",async()=>{
 const {GET}=await import('../src/app/api/councils/[slug]/transactions/route');
 const request=(query:string)=>GET(new NextRequest(`http://localhost/api/councils/one/transactions?${query}`),{params:Promise.resolve({slug:'one'})});
 for(const q of ['page=-1','page=NaN','pageSize=1000000','minAmount=oops','sortDir=nope','startDate=2025-02-31','minAmount=10&maxAmount=1']) assert.equal((await request(q)).status,400,q);
 assert.equal((await request('fy=1900-01')).status,404);
 const response=await request('format=csv');assert.equal(response.status,200);
 const csv=await response.text();assert.equal(csv.trim().split('\r\n').length,521);
});

test("dashboard filters follow the selected year and missing suppliers are not called redacted",async()=>{
 const {getFlags,getDirectoratesList,getCategoriesList,getTopSuppliers}=await import('../src/lib/queries');
 assert.deepEqual(await getDirectoratesList(2,2),['Current service']);
 assert.deepEqual(await getCategoriesList(2,2),['Current category']);
 const flags=await getFlags(2,2,await getTopSuppliers(2,2,20));
 const redacted=flags.find(f=>f.type==='redacted_spend');
 assert.equal(redacted?.title,'£100 to redacted suppliers');
 assert.match(redacted?.detail||'',/^1 payments/);
});

test("council directory reports valid retained payment presence and excludes unregistered councils",async()=>{
 const {getCouncilDirectory}=await import('../src/lib/queries');
 const rows=await getCouncilDirectory();
 assert.deepEqual(Object.fromEntries(rows.map(row=>[row.slug,row.hasPayments])),{invalid:false,one:true,stale:false,two:true});
 const {GET}=await import('../src/app/api/councils/route');
 const response=await GET(new Request('http://localhost/api/councils?summary=1'));
 assert.deepEqual(await response.json(),rows);
});
