-- Canonical schema for council-spend.
-- Used by:
--   - scripts/pipeline.ts and scripts/seed-registry.ts (local SQLite via better-sqlite3)
--   - scripts/d1/migrate.ts (Cloudflare D1)
-- All DDL must be idempotent (CREATE TABLE IF NOT EXISTS, etc.) so this
-- file can be re-applied safely.

CREATE TABLE IF NOT EXISTS councils (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  region TEXT,
  transparency_url TEXT,
  data_gov_id TEXT,
  scrape_profile TEXT,
  scrape_status TEXT DEFAULT 'pending',
  last_scraped_at TEXT,
  file_pattern TEXT
);

CREATE TABLE IF NOT EXISTS financial_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id INTEGER NOT NULL REFERENCES councils(id),
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id INTEGER NOT NULL REFERENCES councils(id),
  name TEXT NOT NULL,
  normalised_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id INTEGER NOT NULL REFERENCES councils(id),
  financial_year_id INTEGER REFERENCES financial_years(id),
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL,
  downloaded_at TEXT,
  column_mapping TEXT
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
  directorate TEXT,
  service TEXT,
  category TEXT,
  net_budget REAL,
  gross_budget REAL
);

CREATE TABLE IF NOT EXISTS outturns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
  directorate TEXT,
  service TEXT,
  net_outturn REAL,
  variance REAL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id INTEGER NOT NULL REFERENCES councils(id),
  financial_year_id INTEGER REFERENCES financial_years(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  service TEXT,
  directorate TEXT,
  category TEXT,
  description TEXT,
  amount REAL NOT NULL,
  date TEXT,
  month TEXT,
  source_document_id INTEGER REFERENCES source_documents(id)
);

CREATE INDEX IF NOT EXISTS fy_council_idx ON financial_years(council_id);
CREATE INDEX IF NOT EXISTS supplier_normalised_idx ON suppliers(council_id, normalised_name);
CREATE INDEX IF NOT EXISTS source_doc_council_idx ON source_documents(council_id);
CREATE INDEX IF NOT EXISTS source_doc_url_idx ON source_documents(url);
CREATE INDEX IF NOT EXISTS budget_fy_idx ON budgets(financial_year_id);
CREATE INDEX IF NOT EXISTS outturn_fy_idx ON outturns(financial_year_id);
CREATE INDEX IF NOT EXISTS txn_council_date_idx ON transactions(council_id, date);
CREATE INDEX IF NOT EXISTS txn_supplier_idx ON transactions(supplier_id);
CREATE INDEX IF NOT EXISTS txn_directorate_idx ON transactions(council_id, directorate);
CREATE INDEX IF NOT EXISTS txn_category_idx ON transactions(council_id, category);
CREATE INDEX IF NOT EXISTS txn_month_idx ON transactions(council_id, month);
CREATE INDEX IF NOT EXISTS txn_fy_idx ON transactions(council_id, financial_year_id);
