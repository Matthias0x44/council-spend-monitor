/** Match CKAN publishers only against the verified English authority register. */
import Database from "better-sqlite3";
import fs from "node:fs";
const normalize=(s:string)=>s.toLowerCase().replace(/city of|royal borough of|london borough of|metropolitan|borough|district|county|city|council/g,"").replace(/[^a-z0-9]/g,"");
async function main(){
 const db=new Database(process.env.LOCAL_DB_PATH || "data/council-spend.db");
 const councils=db.prepare("SELECT id,name,slug FROM councils").all() as {id:number;name:string;slug:string}[];
 const adapters=JSON.parse(fs.readFileSync("data/source-adapters.json","utf8")) as Record<string,{transparencyUrl?:string;dataGovId?:string;packages?:string[]}>;
 let matches=0;
 for(const q of ["spending over 500","expenditure over 500","payments suppliers","spending over 250"]){
  for(let start=0;start<3000;start+=100){
   const url=`https://data.gov.uk/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=100&start=${start}`;
   const res=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!res.ok)throw new Error(`CKAN ${res.status}`);
   const data=await res.json() as {success:boolean;result:{count:number;results:{id:string;title:string;organization?:{title:string};resources:{format:string}[]}[]}};
   if(!data.success)throw new Error("CKAN failed");
   for(const pkg of data.result.results){
    if(!/spend|expenditure|payments/i.test(pkg.title)||!/500|250|supplier/i.test(pkg.title))continue;
    if(!pkg.resources.some(r=>/^(csv|xlsx|xls)$/i.test(r.format)))continue;
    const council=councils.find(c=>normalize(c.name)===normalize(pkg.organization?.title||""));if(!council)continue;
    const a=adapters[council.slug] ||= {};a.packages ||= [];
    if(!a.packages.includes(pkg.id)){a.packages.push(pkg.id);matches++;}
    db.prepare("UPDATE councils SET data_gov_id=COALESCE(data_gov_id,?) WHERE id=?").run(pkg.id,council.id);
   }
   if(start+100>=data.result.count)break;
  }
 }
 fs.writeFileSync("data/source-adapters.json",JSON.stringify(adapters,null,2));db.close();console.log(`Added ${matches} matched spending datasets`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
