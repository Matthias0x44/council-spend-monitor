import fs from 'node:fs';
import {rows,query,bookmark,literal} from './lib/d1-client.mjs';
import {isPaymentPublication} from './lib/publication-type.mjs';
const sources=await rows("SELECT d.id,d.filename,d.url,c.slug FROM source_documents d JOIN councils c ON c.id=d.council_id");
const rejected=sources.filter(d=>!isPaymentPublication(d.filename));
const documents=[];
for(const document of rejected){
 const [{n}]=await rows('SELECT COUNT(*) n FROM transactions WHERE source_document_id=?',[document.id]);
 if(n)documents.push({...document,rows:n});
}
fs.mkdirSync('data/reports',{recursive:true});
fs.writeFileSync('data/reports/d1-nonpayment-review.json',JSON.stringify({generatedAt:new Date().toISOString(),documents},null,2));
console.log(documents);
if(!process.argv.includes('--apply')||!documents.length)process.exit(0);
await bookmark('d1-before-nonpayment-quarantine');
const ids=documents.map(d=>d.id).join(',');
await query(`INSERT OR IGNORE INTO transaction_quarantine SELECT *,'nonpayment_publication',${literal(new Date().toISOString())} FROM transactions WHERE source_document_id IN (${ids}); DELETE FROM transactions WHERE source_document_id IN (${ids}) AND id IN (SELECT id FROM transaction_quarantine)`);
fs.writeFileSync('data/reports/d1-nonpayment-quarantine.json',JSON.stringify({generatedAt:new Date().toISOString(),documents},null,2));
