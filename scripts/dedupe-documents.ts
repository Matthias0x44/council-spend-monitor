import { compressedBackup } from "./lib/backup";
/** Remove only complete, identical transaction multisets across source documents. */
import Database from "better-sqlite3";
import fs from "node:fs";
import { documentFingerprint, type FingerprintRow } from "./lib/fingerprint";
import { migrate } from "./lib/migrate";
async function main(){
 const db=new Database(process.env.LOCAL_DB_PATH || "data/council-spend.db");migrate(db);db.pragma("foreign_keys = ON");
 const apply=process.argv.includes("--apply");
 if(apply){fs.mkdirSync("data/recovery",{recursive:true});console.log(await compressedBackup(db,"pre-dedupe"));}
 const docs=db.prepare("SELECT id,council_id councilId,url FROM source_documents ORDER BY id").all() as {id:number;councilId:number;url:string}[];
 const seen=new Map<string,number>();const duplicates=[];
 for(const doc of docs){
  const rows=db.prepare("SELECT supplier_id supplierId,amount,date,month,service,directorate,category,description FROM transactions WHERE source_document_id=?").all(doc.id) as FingerprintRow[];
  if(!rows.length)continue;
  const hash=documentFingerprint(rows),key=`${doc.councilId}:${hash}`,original=seen.get(key);
  if(original){duplicates.push({id:doc.id,original,rows:rows.length,url:doc.url});if(apply)db.transaction(()=>{db.prepare("DELETE FROM transactions WHERE source_document_id=?").run(doc.id);db.prepare("DELETE FROM source_documents WHERE id=?").run(doc.id);})();}
  else{seen.set(key,doc.id);if(apply)db.prepare("UPDATE source_documents SET semantic_hash=? WHERE id=?").run(hash,doc.id);}
 }
 fs.writeFileSync("data/reports/duplicate-documents.json",JSON.stringify({apply,duplicates},null,2));console.log({apply,duplicateFiles:duplicates.length,duplicateRows:duplicates.reduce((n,d)=>n+d.rows,0)});db.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
