import fs from 'node:fs';
if(fs.existsSync('.env'))process.loadEnvFile('.env');
const id=process.env.D1_DATABASE_ID||'e1775f4f-2c8c-40c8-bc31-5b09ba536313';
export const databaseId=id;
const base=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${id}`;
export async function d1Request(path,body){
 if(!process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_API_TOKEN)throw new Error('Cloudflare credentials missing');
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 const data=await response.json();if(!response.ok||!data.success)throw new Error(`D1 ${response.status}: ${JSON.stringify(data.errors)}`);
 return data.result;
}
export async function query(sql,params=[]){return d1Request('/query',{sql,params});}
export async function rows(sql,params=[]){return (await query(sql,params))[0].results;}
export async function bookmark(label){const result=await d1Request('/time_travel/bookmark');fs.mkdirSync('data/reports',{recursive:true});const receipt={databaseId:id,capturedAt:new Date().toISOString(),...result};fs.writeFileSync(`data/reports/${label}-bookmark.json`,JSON.stringify(receipt,null,2));return receipt;}
export function literal(value){if(value==null)return 'NULL';if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Non-finite SQL value');return String(value);}return "'"+String(value).replace(/'/g,"''")+"'";}
