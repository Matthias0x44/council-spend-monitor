import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseIsolated} from '../scripts/lib/parse-isolated';
import {retryAfterMs} from '../scripts/lib/public-fetch';
import {fiscalWindow} from '../src/lib/fiscal';
import {discoverViaHtml} from '../scripts/lib/discover';
import {monthFingerprints} from '../scripts/lib/month-fingerprints';
import type {ParsedRow} from '../scripts/lib/parse-isolated';
test('monthly fingerprints reconcile annual copies while retaining repeated lines',()=>{
 const a={supplier_norm:'ONE',fy_label:'2025-26',service:'',directorate:'',category:'',description:'',amount:600,date:'2025-04-01',month:'2025-04'} as ParsedRow;
 const b={...a,month:'2025-05',date:'2025-05-01'};
 const annual=monthFingerprints([a,a,b]);
 assert.equal(annual.find(p=>p.month==='2025-04')?.hash,monthFingerprints([a,a])[0].hash);
 assert.notEqual(monthFingerprints([a,a])[0].hash,monthFingerprints([a])[0].hash);
 assert.equal(annual.find(p=>p.month==='2025-04')?.rows,2);
});
test('source Retry-After supports seconds and dates with a minimum cooldown',()=>{
 const now=Date.parse('2026-09-22T12:00:00Z');
 assert.equal(retryAfterMs('120',now),120000);
 assert.equal(retryAfterMs('Tue, 22 Sep 2026 12:02:00 GMT',now),120000);
 assert.equal(retryAfterMs(null,now),60000);
});
test('isolated parser returns data and is terminable on deadline',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parser-test-'));
 try{
  const file=path.join(dir,'payments.csv');fs.writeFileSync(file,`Supplier,Amount,Date,Service\nExample Ltd,600,${fiscalWindow().start},Adult social care\n`);
  const input={name:'Example',slug:'example',filePath:file,fileUrl:'https://example.gov.uk/payments.csv',profile:null};
  const result=await parseIsolated(input);
  assert.equal(result.parsed.inserted,1);assert.equal(result.data[0].supplier_name,'Example Ltd');
  await assert.rejects(parseIsolated(input,1),/exceeded/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('discovery resolves relative archives and excludes contract registers',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async input=>new Response(String(input).endsWith('/spend/index')
  ? '<a href="april.csv" aria-label="April 2026 payments"></a><a href="contracts-register-April.xlsx">Supplier contract register April</a><a href="archive-2025">Spending archive 2025</a>'
  : '<a href="may.csv">May payments</a>',{status:200});
 try{
  const files=await discoverViaHtml('https://example.gov.uk/spend/index');
  assert.deepEqual(files.map(f=>f.url).sort(),['https://example.gov.uk/spend/april.csv','https://example.gov.uk/spend/may.csv']);
 }finally{globalThis.fetch=original;}
});

test('payment-source filtering also rejects legacy tax and asset registers', async()=>{
 const {isPaymentPublication}=await import('../scripts/lib/publication-type.mjs');
 for(const filename of ['business-rates-as-of-jul-2026.xlsx','ContractRegisterJan2025.csv','non_domestic_rates.xlsx','asset-register.csv'])assert.equal(isPaymentPublication(filename),false,filename);
 assert.equal(isPaymentPublication('payments-to-suppliers-2025-2026.xlsx'),true);
});
