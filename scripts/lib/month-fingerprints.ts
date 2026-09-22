import {createHash} from 'node:crypto';
import type {ParsedRow} from './parse-isolated';
export function monthFingerprints(rows:ParsedRow[]){
 const groups=new Map<string,string[]>();
 for(const r of rows){
  const values=groups.get(r.month)||[];
  values.push(JSON.stringify([r.supplier_norm,r.fy_label,r.service,r.directorate,r.category,r.description,r.amount,r.date,r.month]));
  groups.set(r.month,values);
 }
 return [...groups].map(([month,values])=>({month,hash:createHash('sha256').update(values.sort().join('\n')).digest('hex'),rows:values.length}));
}
