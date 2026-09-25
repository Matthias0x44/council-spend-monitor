-- Apply ONCE to an existing database, before deploying the new Worker.
ALTER TABLE source_documents ADD COLUMN content_hash TEXT;
ALTER TABLE transactions ADD COLUMN service_classification TEXT NOT NULL DEFAULT 'Unclassified';
ALTER TABLE transactions ADD COLUMN classification_method TEXT NOT NULL DEFAULT 'unresolved';
ALTER TABLE transactions ADD COLUMN classification_evidence TEXT;
ALTER TABLE transactions ADD COLUMN classifier_version TEXT;
CREATE INDEX IF NOT EXISTS source_content_idx ON source_documents(council_id, content_hash);
ALTER TABLE source_documents ADD COLUMN semantic_hash TEXT;
CREATE INDEX IF NOT EXISTS source_semantic_idx ON source_documents(council_id, semantic_hash);
