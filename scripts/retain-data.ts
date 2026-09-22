import { compressedBackup } from "./lib/backup";
/** Dry run by default. --apply prunes after a consistent SQLite backup. */
import Database from "better-sqlite3";
import fs from "node:fs";
import { fiscalWindow } from "../src/lib/fiscal";
async function main(){
 const db=new Database(process.env.LOCAL_DB_PATH || "data/council-spend.db");db.pragma("foreign_keys = ON");
 const w=fiscalWindow();
 const condition="month IS NULL OR month = '' OR month < ? OR month >= ? OR date > ?";
 const values=[w.start.slice(0,7),w.endExclusive.slice(0,7),w.through];
 const rows=db.prepare(`SELECT COUNT(*) n FROM transactions WHERE ${condition}`).get(...values);
 console.log({window:w,prune:rows,apply:process.argv.includes("--apply")});
 if(process.argv.includes("--apply")){
  fs.mkdirSync("data/recovery",{recursive:true});const backup=await compressedBackup(db,"pre-retention");
  db.transaction(()=>{
   db.prepare(`DELETE FROM transactions WHERE ${condition}`).run(...values);
   db.exec("DELETE FROM suppliers WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE supplier_id=suppliers.id)");
   // Keep source lineage for retained transactions, including cross-year files.
   db.prepare("DELETE FROM source_documents WHERE NOT EXISTS(SELECT 1 FROM transactions WHERE source_document_id=source_documents.id) AND financial_year_id IN (SELECT id FROM financial_years WHERE start_date < ? OR start_date >= ?)").run(w.start,w.endExclusive);
   for(const table of ["budgets","outturns"])db.prepare(`DELETE FROM ${table} WHERE financial_year_id IN (SELECT id FROM financial_years WHERE start_date < ? OR start_date >= ?)`).run(w.start,w.endExclusive);
   db.prepare("UPDATE source_documents SET financial_year_id=NULL WHERE financial_year_id IN (SELECT id FROM financial_years WHERE start_date < ? OR start_date >= ?)").run(w.start,w.endExclusive);
   db.prepare("DELETE FROM financial_years WHERE start_date < ? OR start_date >= ?").run(w.start,w.endExclusive);
  })();console.log(`Backup: ${backup}`);
 }
 db.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
