import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const councils = sqliteTable("councils", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  region: text("region"),
});

export const financialYears = sqliteTable(
  "financial_years",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    councilId: integer("council_id")
      .notNull()
      .references(() => councils.id),
    label: text("label").notNull(), // e.g. "2024-25"
    startDate: text("start_date").notNull(), // ISO date
    endDate: text("end_date").notNull(),
  },
  (table) => [
    index("fy_council_idx").on(table.councilId),
  ]
);

export const suppliers = sqliteTable(
  "suppliers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    councilId: integer("council_id")
      .notNull()
      .references(() => councils.id),
    name: text("name").notNull(),
    normalisedName: text("normalised_name").notNull(),
  },
  (table) => [
    index("supplier_normalised_idx").on(table.councilId, table.normalisedName),
  ]
);

export const sourceDocuments = sqliteTable(
  "source_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    councilId: integer("council_id")
      .notNull()
      .references(() => councils.id),
    financialYearId: integer("financial_year_id").references(
      () => financialYears.id
    ),
    filename: text("filename").notNull(),
    url: text("url").notNull(),
    type: text("type").notNull(), // expenditure | budget | accounts | procurement_card
    downloadedAt: text("downloaded_at"),
  },
  (table) => [
    index("source_doc_council_idx").on(table.councilId),
  ]
);

export const budgets = sqliteTable(
  "budgets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    financialYearId: integer("financial_year_id")
      .notNull()
      .references(() => financialYears.id),
    directorate: text("directorate"),
    service: text("service"),
    category: text("category"),
    netBudget: real("net_budget"),
    grossBudget: real("gross_budget"),
  },
  (table) => [
    index("budget_fy_idx").on(table.financialYearId),
  ]
);

export const outturns = sqliteTable(
  "outturns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    financialYearId: integer("financial_year_id")
      .notNull()
      .references(() => financialYears.id),
    directorate: text("directorate"),
    service: text("service"),
    netOutturn: real("net_outturn"),
    variance: real("variance"),
  },
  (table) => [
    index("outturn_fy_idx").on(table.financialYearId),
  ]
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    councilId: integer("council_id")
      .notNull()
      .references(() => councils.id),
    financialYearId: integer("financial_year_id").references(
      () => financialYears.id
    ),
    supplierId: integer("supplier_id").references(() => suppliers.id),
    service: text("service"),
    directorate: text("directorate"),
    category: text("category"),
    description: text("description"),
    amount: real("amount").notNull(),
    date: text("date"), // ISO date
    month: text("month"), // YYYY-MM
    sourceDocumentId: integer("source_document_id").references(
      () => sourceDocuments.id
    ),
  },
  (table) => [
    index("txn_council_date_idx").on(table.councilId, table.date),
    index("txn_supplier_idx").on(table.supplierId),
    index("txn_directorate_idx").on(table.councilId, table.directorate),
    index("txn_category_idx").on(table.councilId, table.category),
    index("txn_month_idx").on(table.councilId, table.month),
    index("txn_fy_idx").on(table.councilId, table.financialYearId),
  ]
);
