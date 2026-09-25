import fs from 'node:fs';
if(fs.existsSync('.env'))process.loadEnvFile('.env');
const id=process.env.D1_DATABASE_ID||'e1775f4f-2c8c-40c8-bc31-5b09ba536313';
const sql=process.argv[2];if(!sql||! /^(SELECT|PRAGMA|WITH|EXPLAIN QUERY PLAN SELECT)\b/i.test(sql.trim()))throw new Error('Read-only SQL required');
const res=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${id}/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql}),signal:AbortSignal.timeout(60000)});
const json=await res.json();if(!res.ok||!json.success)throw new Error(JSON.stringify(json.errors));console.log(JSON.stringify(json.result));
