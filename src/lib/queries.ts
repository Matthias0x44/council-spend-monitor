import { fiscalWindow } from "./fiscal";
import { classifyService, CLASSIFIER_VERSION } from "./classifier";
import { getDb } from "@/db";
import { councils, financialYears, budgets, outturns, transactions, suppliers, sourceDocuments } from "@/db/schema";
import { eq, and, desc, asc, sql, gte, SQL, lt } from "drizzle-orm";


function validTransactionPeriod(fyId?: number): SQL {
  // D1's sampled statistics select the five-year month index even when a
  // council/year key is known. Unary + keeps the ISO-text comparisons but
  // excludes that competing range from index selection. EXPLAIN and live
  // measurements confirm the year index reads fewer rows. Both operands are
  // text; never bind numeric dates here (unary + removes column affinity).
  const month = fyId ? sql`+${transactions.month}` : sql`${transactions.month}`;
  const window = fiscalWindow();
  return sql`${month} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(${month},6,2) BETWEEN '01' AND '12' AND ${month} >= ${window.start.slice(0,7)} AND ${month} < ${window.endExclusive.slice(0,7)} AND ${month} <= ${window.through.slice(0,7)} AND (${transactions.date} IS NULL OR ${transactions.date} = '' OR (${transactions.date} <= ${window.through} AND strftime('%Y-%m-%d',julianday(${transactions.date})) = ${transactions.date}))`;
}

export async function getCouncilBySlug(slug: string) {
  const db = await getDb();
  return db.select().from(councils).where(and(eq(councils.slug, slug), sql`EXISTS (SELECT 1 FROM english_authorities WHERE council_id=${councils.id})`)).get();
}

export async function getCouncilDirectory() {
  const db = await getDb();
  // The directory needs presence, not an exact ledger count. EXISTS stops at
  // the first valid payment instead of counting millions of rows per search.
  return db.select({
    id: councils.id,
    name: councils.name,
    slug: councils.slug,
    region: councils.region,
    hasPayments: sql<boolean>`EXISTS (SELECT 1 FROM transactions INDEXED BY txn_month_idx WHERE council_id="councils"."id" AND ${validTransactionPeriod()})`.mapWith({mapFromDriverValue: value => Number(value) === 1}),
  }).from(councils)
    .where(sql`EXISTS (SELECT 1 FROM english_authorities WHERE council_id=${councils.id})`)
    .orderBy(councils.name).all();
}

export async function getFinancialYears(councilId: number) {
  const db = await getDb();
  return db
    .select()
    .from(financialYears)
    .where(and(eq(financialYears.councilId, councilId), gte(financialYears.startDate, fiscalWindow().start), lt(financialYears.startDate, fiscalWindow().endExclusive), sql`EXISTS (SELECT 1 FROM transactions INDEXED BY txn_fy_idx WHERE financial_year_id=${financialYears.id} AND council_id=${councilId} AND ${validTransactionPeriod()})`))
    .orderBy(desc(financialYears.label))
    .all();
}

export async function getLatestFinancialYear(councilId: number) {
  const db = await getDb();
  return db
    .select()
    .from(financialYears)
    .where(and(eq(financialYears.councilId, councilId), gte(financialYears.startDate, fiscalWindow().start), lt(financialYears.startDate, fiscalWindow().endExclusive), sql`EXISTS (SELECT 1 FROM transactions INDEXED BY txn_fy_idx WHERE financial_year_id=${financialYears.id} AND council_id=${councilId} AND ${validTransactionPeriod()})`))
    .orderBy(desc(financialYears.label))
    .limit(1)
    .get();
}

export async function getOverview(councilId: number, fyId?: number) {
  const db = await getDb();
  const spendConditions: SQL[] = [eq(transactions.councilId, councilId), validTransactionPeriod(fyId)];
  if (fyId) spendConditions.push(eq(transactions.financialYearId, fyId));

  const [totalBudget, totalOutturn, totalSpend] = await Promise.all([
    db
      .select({
        totalNet: sql<number>`COALESCE(SUM(${budgets.netBudget}), 0)`,
        totalGross: sql<number>`COALESCE(SUM(${budgets.grossBudget}), 0)`,
      })
      .from(budgets)
      .where(and(sql`${budgets.financialYearId} IN (SELECT id FROM financial_years WHERE council_id = ${councilId} AND start_date >= ${fiscalWindow().start} AND start_date < ${fiscalWindow().endExclusive})`, fyId ? eq(budgets.financialYearId, fyId) : undefined))
      .get(),
    db
      .select({
        totalOutturn: sql<number>`COALESCE(SUM(${outturns.netOutturn}), 0)`,
        totalVariance: sql<number>`COALESCE(SUM(${outturns.variance}), 0)`,
      })
      .from(outturns)
      .where(and(sql`${outturns.financialYearId} IN (SELECT id FROM financial_years WHERE council_id = ${councilId} AND start_date >= ${fiscalWindow().start} AND start_date < ${fiscalWindow().endExclusive})`, fyId ? eq(outturns.financialYearId, fyId) : undefined))
      .get(),
    db
      .select({
        total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
        count: sql<number>`COUNT(*)`,
        supplierCount: sql<number>`COUNT(DISTINCT ${transactions.supplierId})`,
      })
      .from(transactions)
      .where(and(...spendConditions))
      .get(),
  ]);

  // Month presence alone cannot certify a complete publication. Keep annual
  // comparisons unavailable until source-level completeness has been reviewed.
  const yoyChange: number | null = null;

  return {
    budget: {
      net: totalBudget?.totalNet ?? 0,
      gross: totalBudget?.totalGross ?? 0,
    },
    outturn: {
      net: totalOutturn?.totalOutturn ?? 0,
      variance: totalOutturn?.totalVariance ?? 0,
    },
    spend: {
      total: totalSpend?.total ?? 0,
      transactionCount: totalSpend?.count ?? 0,
    },
    supplierCount: totalSpend?.supplierCount ?? 0,
    yoyChange,
  };
}

export interface TransactionFilters {
  fyId?: number;
  directorate?: string;
  category?: string;
  supplier?: string;
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export async function getTransactions(councilId: number, filters: TransactionFilters, knownTotal?: number) {
  const db = await getDb();
  const page = Math.max(1, Math.min(100000, Math.trunc(filters.page || 1)));
  const pageSize = Math.max(1, Math.min(500, Math.trunc(filters.pageSize || 50)));
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [eq(transactions.councilId, councilId), validTransactionPeriod(filters.fyId)];

  if (filters.fyId) conditions.push(eq(transactions.financialYearId, filters.fyId));
  if (filters.directorate) conditions.push(eq(transactions.directorate, filters.directorate));
  if (filters.category) conditions.push(eq(transactions.category, filters.category));
  if (filters.minAmount !== undefined) conditions.push(gte(transactions.amount, filters.minAmount));
  if (filters.maxAmount !== undefined) conditions.push(sql`${transactions.amount} <= ${filters.maxAmount}`);
  if (filters.startDate) conditions.push(gte(transactions.date, filters.startDate));
  if (filters.endDate) conditions.push(sql`${transactions.date} <= ${filters.endDate}`);
  if (filters.supplier) conditions.push(sql`${transactions.supplierId} IN (SELECT id FROM suppliers WHERE council_id = ${councilId} AND name LIKE ${"%" + filters.supplier + "%"})`);
  if (filters.search) {
    conditions.push(
      sql`(${transactions.description} LIKE ${"%" + filters.search + "%"} OR ${transactions.service} LIKE ${"%" + filters.search + "%"} OR ${transactions.supplierId} IN (SELECT id FROM suppliers WHERE council_id = ${councilId} AND name LIKE ${"%" + filters.search + "%"}))`
    );
  }

  const where = and(...conditions)!;

  const sortColumn = (() => {
    switch (filters.sortBy) {
      case "amount": return transactions.amount;
      case "date": return transactions.date;
      case "supplier": return suppliers.name;
      case "directorate": return transactions.directorate;
      default: return transactions.amount;
    }
  })();
  const order = filters.sortDir === "asc" ? asc(sortColumn) : desc(sortColumn);

  const rows = await db
    .select({
      id: transactions.id,
      supplierName: suppliers.name,
      amount: transactions.amount,
      date: transactions.date,
      month: transactions.month,
      directorate: transactions.directorate,
      service: transactions.service,
      category: transactions.category,
      description: transactions.description,
      sourceFile: sourceDocuments.filename,
      sourceUrl: sourceDocuments.url,
      serviceClassification: transactions.serviceClassification,
      classificationMethod: transactions.classificationMethod,
      classificationEvidence: transactions.classificationEvidence,
      classifierVersion: transactions.classifierVersion,
    })
    .from(transactions)
    .leftJoin(suppliers, eq(transactions.supplierId, suppliers.id))
    .leftJoin(sourceDocuments, eq(transactions.sourceDocumentId, sourceDocuments.id))
    .where(where)
    .orderBy(order, asc(transactions.id))
    .limit(pageSize)
    .offset(offset)
    .all();

  // A streaming export reuses its initial count instead of rescanning the
  // entire ledger for every 500-row chunk.
  const countResult = knownTotal === undefined ? await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(where)
    .get() : { count: knownTotal };

  return {
    rows: rows.map(row => {
      const classification = classifyService(row);
      return { ...row, serviceClassification: classification.label, classificationMethod: classification.method, classificationEvidence: classification.evidence, classifierVersion: classification.version };
    }),
    total: countResult?.count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((countResult?.count ?? 0) / pageSize),
  };
}

export async function getSpendByCategory(councilId: number, fyId?: number) {
  const db = await getDb();
  const conditions: SQL[] = [eq(transactions.councilId, councilId), validTransactionPeriod(fyId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));

  const raw = await db
    .select({
      category: transactions.category,
      total: sql<number>`SUM(${transactions.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.category)
    .orderBy(desc(sql`SUM(${transactions.amount})`))
    .all();

  return raw.map((r) => ({
    ...r,
    category: r.category && r.category.trim() !== "" ? r.category : "No Category",
  }));
}

export async function getSpendByDirectorate(councilId: number, fyId?: number) {
  const db = await getDb();
  const conditions: SQL[] = [eq(transactions.councilId, councilId), validTransactionPeriod(fyId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));

  const label = sql<string>`COALESCE(NULLIF(TRIM(${transactions.directorate}), ''), NULLIF(TRIM(${transactions.service}), ''), 'No Service Area')`;
  const raw = await db.select({ directorate: label, total: sql<number>`SUM(${transactions.amount})`, count: sql<number>`COUNT(*)` })
    .from(transactions).where(and(...conditions)).groupBy(label)
    .orderBy(desc(sql`SUM(${transactions.amount})`)).all();
  // Keep all payments represented, including missing service labels and the tail.
  if (raw.length <= 15) return raw;
  return [...raw.slice(0, 14), { directorate: 'Other service areas', total: raw.slice(14).reduce((n,r)=>n+r.total,0), count: raw.slice(14).reduce((n,r)=>n+r.count,0) }];
}

export async function getTopSuppliers(councilId: number, fyId?: number, limit = 20) {
  const db = await getDb();
  const conditions: SQL[] = [eq(transactions.councilId, councilId), validTransactionPeriod(fyId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));
  const where = and(...conditions)!;

  const [totalSpend, topSup] = await Promise.all([
    db.select({ total: sql<number>`SUM(${transactions.amount})` })
      .from(transactions).where(where).get(),
    db.select({
      supplierId: transactions.supplierId,
      supplierName: suppliers.name,
      total: sql<number>`SUM(${transactions.amount})`,
      count: sql<number>`COUNT(*)`,
    }).from(transactions)
      .leftJoin(suppliers, eq(transactions.supplierId, suppliers.id))
      .where(where)
      .groupBy(transactions.supplierId)
      .orderBy(desc(sql`SUM(${transactions.amount})`))
      .limit(limit)
      .all(),
  ]);

  const grandTotal = totalSpend?.total ?? 1;
  return topSup.map((s) => ({
    ...s,
    percentage: grandTotal > 0 ? (s.total / grandTotal) * 100 : 0,
  }));
}

export async function getMonthlyTrend(councilId: number, fyId?: number) {
  const db = await getDb();
  const conditions: SQL[] = [eq(transactions.councilId, councilId), validTransactionPeriod(fyId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));

  const raw = await db
    .select({
      month: transactions.month,
      total: sql<number>`SUM(${transactions.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.month)
    .orderBy(asc(transactions.month))
    .all();

  const known = new Map(raw.filter(r => r.month).map(r => [r.month, r]));
  let start = fiscalWindow().start.slice(0,7);
  let end = fiscalWindow().through.slice(0,7);
  if (fyId) {
    const fy = await db.select().from(financialYears).where(and(eq(financialYears.id,fyId),eq(financialYears.councilId,councilId))).get();
    if (fy) { start = fy.startDate.slice(0,7); end = fy.endDate.slice(0,7) < end ? fy.endDate.slice(0,7) : end; }
  }
  const months: { month: string; total: number | null; count: number }[] = [];
  for (let month = start; month <= end;) {
    const row = known.get(month);
    months.push({ month, total: row?.total ?? null, count: row?.count ?? 0 });
    const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth()+1); month = d.toISOString().slice(0,7);
  }
  return months;
}

const REDACTED_NAMES = new Set([
  "REDACTED DATA",
  "REDACTED PERSONAL DATA",
  "Redacted",
  "REDACTED",
  "Redacted Personal Data",
  "Redacted Commercial Confidentiality",
]);

function isRedacted(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  return REDACTED_NAMES.has(trimmed) || trimmed.toUpperCase().startsWith("REDACTED");
}

function fmtAmount(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `£${(n / 1_000_000_000).toFixed(1)}bn`;
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 1_000) return `£${(n / 1_000).toFixed(0)}k`;
  return `£${n.toFixed(0)}`;
}

export async function getFlags(councilId: number, fyId?: number, suppliedTopSuppliers?: Awaited<ReturnType<typeof getTopSuppliers>>) {
  const db = await getDb();
  const flags: { type: string; severity: "high" | "medium" | "low"; title: string; detail: string }[] = [];

  const conditions: SQL[] = [eq(transactions.councilId, councilId), validTransactionPeriod(fyId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));
  const where = and(...conditions)!;

  // One pass supplies the three quality totals. A missing supplier is not
  // evidence that the publisher deliberately redacted it.
  const [quality, bigPayments, top5Suppliers] = await Promise.all([
    db.select({
      total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      count: sql<number>`COUNT(*)`,
      redactedTotal: sql<number>`COALESCE(SUM(CASE WHEN UPPER(TRIM(${suppliers.name})) LIKE 'REDACTED%' THEN ${transactions.amount} ELSE 0 END), 0)`,
      redactedCount: sql<number>`SUM(CASE WHEN UPPER(TRIM(${suppliers.name})) LIKE 'REDACTED%' THEN 1 ELSE 0 END)`,
      blankTotal: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.category} IS NULL OR TRIM(${transactions.category}) = '' OR ${transactions.category} = 'REDACTED DATA' THEN ${transactions.amount} ELSE 0 END), 0)`,
      blankCount: sql<number>`SUM(CASE WHEN ${transactions.category} IS NULL OR TRIM(${transactions.category}) = '' OR ${transactions.category} = 'REDACTED DATA' THEN 1 ELSE 0 END)`,
    }).from(transactions)
      .leftJoin(suppliers, eq(transactions.supplierId, suppliers.id))
      .where(where).get(),

    db.select({
      supplierName: suppliers.name,
      normalisedName: suppliers.normalisedName,
      amount: transactions.amount,
      date: transactions.date,
      description: transactions.description,
    }).from(transactions)
      .leftJoin(suppliers, eq(transactions.supplierId, suppliers.id))
      .where(and(where, gte(transactions.amount, 1_000_000)))
      .orderBy(desc(transactions.amount))
      .limit(50)
      .all(),

    suppliedTopSuppliers ? Promise.resolve(suppliedTopSuppliers.slice(0, 5)) : getTopSuppliers(councilId, fyId, 5),
  ]);

  const grandTotal = quality?.total ?? 1;
  const redactedSpend = { total: quality?.redactedTotal ?? 0, count: quality?.redactedCount ?? 0 };
  const blankCats = { total: quality?.blankTotal ?? 0, count: quality?.blankCount ?? 0 };

  if (redactedSpend && redactedSpend.total > 0) {
    const pct = grandTotal > 0 ? (redactedSpend.total / grandTotal) * 100 : 0;
    flags.push({
      type: "redacted_spend",
      severity: pct > 30 ? "high" : pct > 15 ? "medium" : "low",
      title: `${fmtAmount(redactedSpend.total)} to redacted suppliers`,
      detail: `${redactedSpend.count.toLocaleString()} payments (${pct.toFixed(0)}% of published net payments). Redaction can protect personal or commercially sensitive information.`,
    });
  }

  if (blankCats && blankCats.count > 0) {
    const pct = grandTotal > 0 ? (blankCats.total / grandTotal) * 100 : 0;
    flags.push({
      type: "missing_data",
      severity: pct > 30 ? "high" : pct > 15 ? "medium" : "low",
      title: `${fmtAmount(blankCats.total)} with no category`,
      detail: `${blankCats.count.toLocaleString()} transactions (${pct.toFixed(0)}% of spend) have blank or redacted category data`,
    });
  }

  const redactedBig = bigPayments.filter((p) => isRedacted(p.supplierName));
  if (redactedBig.length > 0) {
    const redactedBigTotal = redactedBig.reduce((s, p) => s + p.amount, 0);
    flags.push({
      type: "large_payment",
      severity: "high",
      title: `${redactedBig.length} large payments to redacted suppliers`,
      detail: `${fmtAmount(redactedBigTotal)} total across payments over £1m to undisclosed vendors`,
    });
  }

  const namedBig = bigPayments.filter((p) => !isRedacted(p.supplierName) && p.supplierName);
  const seenSuppliers = new Set<string>();
  for (const p of namedBig) {
    const key = p.normalisedName || p.supplierName || "";
    if (seenSuppliers.has(key)) continue;
    seenSuppliers.add(key);
    if (seenSuppliers.size > 3) break;
    flags.push({
      type: "large_payment",
      severity: p.amount >= 5_000_000 ? "high" : "medium",
      title: `${fmtAmount(p.amount)} to ${p.supplierName}`,
      detail: p.description || `${p.date || ""}`,
    });
  }

  const top5Total = top5Suppliers.reduce((sum, s) => sum + s.percentage, 0);
  // A handful of portfolio/sample rows can make concentration appear extreme.
  // The signal is only useful once there are enough published payments.
  if ((quality?.count ?? 0) < 100) return flags;
  if (top5Total > 40) {
    flags.push({
      type: "supplier_concentration",
      severity: "high",
      title: "High supplier concentration",
      detail: `Top 5 suppliers account for ${top5Total.toFixed(1)}% of published net payments`,
    });
  } else if (top5Total > 25) {
    flags.push({
      type: "supplier_concentration",
      severity: "medium",
      title: "Moderate supplier concentration",
      detail: `Top 5 suppliers account for ${top5Total.toFixed(1)}% of published net payments`,
    });
  }


  return flags;
}

export async function getDirectoratesList(councilId: number, fyId?: number) {
  const db = await getDb();
  const raw = await db
    .select({ directorate: transactions.directorate })
    .from(transactions)
    .where(and(eq(transactions.councilId, councilId), fyId ? eq(transactions.financialYearId, fyId) : undefined, validTransactionPeriod(fyId)))
    .groupBy(transactions.directorate)
    .orderBy(asc(transactions.directorate))
    .all();
  return raw.map((r) => r.directorate).filter(Boolean) as string[];
}

export async function getCategoriesList(councilId: number, fyId?: number) {
  const db = await getDb();
  const raw = await db
    .select({ category: transactions.category })
    .from(transactions)
    .where(and(eq(transactions.councilId, councilId), fyId ? eq(transactions.financialYearId, fyId) : undefined, validTransactionPeriod(fyId)))
    .groupBy(transactions.category)
    .orderBy(asc(transactions.category))
    .all();
  return raw.map((r) => r.category).filter(Boolean) as string[];
}

export async function getCoverage(councilId: number, fyId?: number) {
 const db = await getDb();
 const conditions: SQL[] = [eq(transactions.councilId, councilId), validTransactionPeriod(fyId)];
 if (fyId) conditions.push(eq(transactions.financialYearId, fyId));
 const result = await db.select({ months: sql<number>`COUNT(DISTINCT ${transactions.month})`, rows: sql<number>`COUNT(*)`, firstMonth:sql<string | null>`MIN(${transactions.month})`, lastMonth:sql<string | null>`MAX(${transactions.month})`, classified:sql<number>`COALESCE(SUM(CASE WHEN ${transactions.classificationMethod} = 'rule' AND ${transactions.classifierVersion} = ${CLASSIFIER_VERSION} THEN 1 ELSE 0 END),0)` }).from(transactions).where(and(...conditions)).get();
 return result!;
}
