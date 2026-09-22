import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type Database from "better-sqlite3";
/** Space-efficient offline backup; the exclusive rollback-journal lock prevents
 * concurrent writers while the checkpointed main file is compressed. */
export async function compressedBackup(db: Database.Database, label: string) {
 fs.mkdirSync("data/recovery",{recursive:true});
 const destination=`data/recovery/${label}-${Date.now()}.db.gz`;
 const mode=db.pragma("journal_mode",{simple:true}) as string;
 db.pragma("journal_mode = DELETE");
 db.exec("BEGIN EXCLUSIVE");
 try {
  await pipeline(fs.createReadStream(db.name),createGzip(),fs.createWriteStream(destination+".tmp"));
  db.exec("COMMIT");fs.renameSync(destination+".tmp",destination);
 } catch(error){db.exec("ROLLBACK");throw error;}
 finally { if(mode === "wal") db.pragma("journal_mode = WAL"); }
 return destination;
}
