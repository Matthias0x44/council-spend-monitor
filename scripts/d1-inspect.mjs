import fs from 'node:fs';
if(fs.existsSync('.env'))process.loadEnvFile('.env');
const id=process.env.D1_DATABASE_ID || JSON.parse(fs.readFileSync('wrangler.jsonc','utf8').replace(/\/\/[^\n]*/g,'')).d1_databases[0].database_id;
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw new Error('Cloudflare credentials missing');
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${id}`;
async function request(suffix,body){const response=await fetch(base+suffix,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const data=await response.json();if(!response.ok||!data.success)throw new Error(JSON.stringify(data.errors));return data.result;}
console.log('DATABASE',JSON.stringify(await request('')));
for(const sql of ["SELECT name FROM sqlite_master WHERE type='table'","SELECT COUNT(*) councils FROM councils","SELECT COUNT(*) transactions, MIN(month) firstMonth, MAX(month) lastMonth FROM transactions","SELECT scrape_status,COUNT(*) councils FROM councils GROUP BY scrape_status","PRAGMA table_info(transactions)"]){console.log('QUERY',sql,JSON.stringify(await request('/query',{sql})));}
