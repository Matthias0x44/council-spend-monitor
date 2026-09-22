import fs from 'node:fs';
import {rows,query,bookmark,literal} from './lib/d1-client.mjs';
const documents=await rows("SELECT d.id,d.filename,c.slug,COUNT(t.id) rows FROM source_documents d JOIN councils c ON c.id=d.council_id JOIN transactions t ON t.source_document_id=d.id WHERE lower(d.filename) LIKE '%contract%register%' GROUP BY d.id");
console.log(documents);
if(!process.argv.includes('--apply')||!documents.length)process.exit(0);
await bookmark('d1-before-nonpayment-quarantine');
const ids=documents.map(d=>d.id).join(',');
await query(`INSERT OR IGNORE INTO transaction_quarantine SELECT *,'contract_register_not_payment',${literal(new Date().toISOString())} FROM transactions WHERE source_document_id IN (${ids}); DELETE FROM transactions WHERE source_document_id IN (${ids}) AND id IN (SELECT id FROM transaction_quarantine)`);
fs.writeFileSync('data/reports/d1-nonpayment-quarantine.json',JSON.stringify({generatedAt:new Date().toISOString(),documents},null,2));
