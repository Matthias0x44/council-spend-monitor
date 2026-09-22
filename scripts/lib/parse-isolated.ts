import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { IngestResult } from './ingest';
export type ParsedRow={supplier_name:string;supplier_norm:string;fy_label:string;service:string;directorate:string;category:string;description:string;amount:number;date:string;month:string;service_classification:string;classification_method:string;classification_evidence:string;classifier_version:string};
export function parseIsolated(input:{name:string;slug:string;filePath:string;fileUrl:string;profile:Record<string,string>|null},timeoutMs=60000):Promise<{parsed:IngestResult;data:ParsedRow[]}>{
 return new Promise((resolve,reject)=>{
  // A separate OS process also contains native SQLite/parser crashes. Worker
  // threads cannot isolate a native-addon fault from the importing process.
  const child=fork(fileURLToPath(new URL('./parse-worker.mjs',import.meta.url)),[],{
   stdio:['ignore','ignore','pipe','ipc'],execArgv:['--import','tsx','--max-old-space-size=768'],
   // The generated Worker types require production credentials on ProcessEnv;
   // parsing deliberately receives only this smaller, credential-free environment.
   env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,TZ:'Europe/London',NODE_ENV:'production'} as unknown as NodeJS.ProcessEnv,
  });
  let settled=false,stderr='';
  child.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-2000);});
  const timer=setTimeout(()=>{settled=true;child.kill('SIGKILL');reject(new Error(`Spreadsheet parsing exceeded ${timeoutMs}ms; source left unchanged`));},timeoutMs);
  child.once('message',result=>{settled=true;clearTimeout(timer);resolve(result as {parsed:IngestResult;data:ParsedRow[]});});
  child.once('error',error=>{settled=true;clearTimeout(timer);reject(error);});
  child.once('exit',(code,signal)=>{clearTimeout(timer);if(!settled)reject(new Error(`Spreadsheet parser exited (${signal||code}): ${stderr}`));});
  child.send(input);
 });
}
