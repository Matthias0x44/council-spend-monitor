import type Database from "better-sqlite3";
export function migrate(db: Database.Database) {
  const additions: Record<string, Record<string, string>> = {
    source_documents: { content_hash: "TEXT", semantic_hash: "TEXT" },
    transactions: { service_classification: "TEXT NOT NULL DEFAULT 'Unclassified'", classification_method: "TEXT NOT NULL DEFAULT 'unresolved'", classification_evidence: "TEXT", classifier_version: "TEXT" },
  };
  db.transaction(() => {
    for (const [table, columns] of Object.entries(additions)) {
      const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name));
      for (const [column, definition] of Object.entries(columns)) if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    db.exec("CREATE INDEX IF NOT EXISTS source_semantic_idx ON source_documents(council_id, semantic_hash)");
    db.exec("CREATE INDEX IF NOT EXISTS source_content_idx ON source_documents(council_id, content_hash)");
  })();
}
