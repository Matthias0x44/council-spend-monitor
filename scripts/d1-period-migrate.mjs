import {bookmark,query} from './lib/d1-client.mjs';
await bookmark('d1-before-period-fingerprints');
await query(`CREATE TABLE IF NOT EXISTS source_month_fingerprints(council_id INTEGER NOT NULL,source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,month TEXT NOT NULL,hash TEXT NOT NULL,rows INTEGER NOT NULL,PRIMARY KEY(source_document_id,month)); CREATE INDEX IF NOT EXISTS source_month_match_idx ON source_month_fingerprints(council_id,month,hash)`);
console.log('Added source month fingerprint ledger');
