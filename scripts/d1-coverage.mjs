/** Read-only national coverage receipt. Missing months never imply zero spend. */
import fs from 'node:fs';
import { rows, d1Request } from './lib/d1-client.mjs';
const now=new Date(), today=now.toISOString().slice(0,10);
const current=now.getUTCFullYear()-(now.getUTCMonth()<3?1:0);
const start=`${current-4}-04`, through=today.slice(0,7);
const authorities=await rows('SELECT a.*,c.slug FROM english_authorities a JOIN councils c ON c.id=a.council_id ORDER BY a.name');
const monthly=await rows(`SELECT council_id,month,COUNT(*) rows,ROUND(SUM(amount),2) netPayments,SUM(classification_method='rule') classifiedRows,SUM(source_document_id IS NULL) missingSource FROM transactions WHERE council_id IN (SELECT council_id FROM english_authorities) AND month BETWEEN ? AND ? GROUP BY council_id,month`,[start,through]);
for(const authority of authorities){
 const first=authority.start_date?.slice(0,7)>start?authority.start_date.slice(0,7):start;
 const last=authority.end_date&&authority.end_date.slice(0,7)<through?authority.end_date.slice(0,7):through;
 authority.months=[];
 for(let m=first;m<=last;){
  const found=monthly.find(r=>r.council_id===authority.council_id&&r.month===m);
  authority.months.push({month:m,rows:found?.rows||0,netPayments:found?.netPayments??null,classifiedRows:found?.classifiedRows||0,missingSource:found?.missingSource||0,status:found?'present_completeness_unverified':'not_ingested'});
  const d=new Date(`${m}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);m=d.toISOString().slice(0,7);
 }
}
const report={generatedAt:now.toISOString(),window:{start,through},database:await d1Request(''),summary:{authorities:authorities.length,currentAuthorities:authorities.filter(a=>!a.end_date||a.end_date>today).length,authoritiesWithPayments:authorities.filter(a=>a.months.some(m=>m.rows)).length,missingAuthorityMonths:authorities.reduce((n,a)=>n+a.months.filter(m=>!m.rows).length,0),rows:monthly.reduce((n,r)=>n+r.rows,0)},caveat:'Month presence does not certify a complete council publication. Net payments are not total council expenditure. Abolished authorities and successors remain separate.',authorities};
fs.mkdirSync('data/reports',{recursive:true});
fs.writeFileSync('data/reports/d1-coverage.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary,null,2));
