/** Retain invalid legacy rows remotely, outside the public transaction ledger. */
import fs from 'node:fs';
import {query,rows,bookmark,literal} from './lib/d1-client.mjs';
const now=new Date(),year=now.getUTCFullYear()-(now.getUTCMonth()<3?1:0),start=`${year-4}-04`,end=`${year+1}-04`,today=now.toISOString().slice(0,10);
const bad=`month IS NULL OR month='' OR month<${literal(start)} OR month>=${literal(end)} OR month NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' OR substr(month,6,2) NOT BETWEEN '01' AND '12' OR date>${literal(today)} OR (date IS NOT NULL AND date<>'' AND (strftime('%Y-%m-%d',julianday(date)) IS NULL OR strftime('%Y-%m-%d',julianday(date))<>date))`;
const count=await rows(`SELECT COUNT(*) n FROM transactions WHERE ${bad}`);
console.log('Invalid/out-of-window rows',count);
if(!process.argv.includes('--apply'))process.exit(0);
console.log(await bookmark('d1-before-quarantine'));
await query("CREATE TABLE IF NOT EXISTS transaction_quarantine AS SELECT *, CAST(NULL AS TEXT) quarantine_reason, CAST(NULL AS TEXT) quarantined_at FROM transactions WHERE 0; CREATE UNIQUE INDEX IF NOT EXISTS quarantine_original_id_idx ON transaction_quarantine(id)");
let moved=0,cursor=0;
for(;;){
 const candidates=await rows(`SELECT id FROM transactions WHERE id>${cursor} AND (${bad}) ORDER BY id LIMIT 5000`);if(!candidates.length)break;
 cursor=candidates.at(-1).id;
 const ids=candidates.map(r=>r.id).join(',');
 await query(`INSERT OR IGNORE INTO transaction_quarantine SELECT *,'invalid_or_outside_retention',${literal(new Date().toISOString())} FROM transactions WHERE id IN (${ids}); DELETE FROM transactions WHERE id IN (${ids}) AND id IN(SELECT id FROM transaction_quarantine)`);
 moved+=candidates.length;console.log('Quarantined',moved);
}
fs.writeFileSync('data/reports/d1-quarantine.json',JSON.stringify({timestamp:now.toISOString(),start,end,today,moved},null,2));
