/** Remove only cache files demonstrably outside the retention window. */
import fs from "node:fs";
import path from "node:path";
import { monthFromFilename } from "./lib/parse";
import { fiscalWindow } from "../src/lib/fiscal";
const cutoff=fiscalWindow().start.slice(0,7);
const files:{file:string;bytes:number;month:string}[]=[];
for(const dir of fs.readdirSync('data/raw',{withFileTypes:true})){
 if(!dir.isDirectory())continue;
 for(const f of fs.readdirSync(path.join('data/raw',dir.name),{withFileTypes:true})){
  if(!f.isFile()||! /\.(csv|xlsx|xls)$/i.test(f.name))continue;
  const month=monthFromFilename(f.name);
  if(month && month<cutoff){const file=path.join('data/raw',dir.name,f.name);files.push({file,bytes:fs.statSync(file).size,month});}
 }
}
fs.writeFileSync('data/reports/pruned-raw.json',JSON.stringify({cutoff,apply:process.argv.includes('--apply'),files},null,2));
if(process.argv.includes('--apply'))for(const f of files)fs.unlinkSync(f.file);
console.log({files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),apply:process.argv.includes('--apply')});
