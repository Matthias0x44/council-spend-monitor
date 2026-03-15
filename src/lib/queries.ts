import { getDb } from "@/db";
import { councils, financialYears, budgets, outturns, transactions, suppliers, sourceDocuments } from "@/db/schema";
import { eq, and, desc, asc, sql, like, gte, lte, SQL } from "drizzle-orm";

export function getCouncilBySlug(slug: string) {
  return getDb().select().from(councils).where(eq(councils.slug, slug)).get();
}

export function getFinancialYears(councilId: number) {
  return getDb()
    .select()
    .from(financialYears)
    .where(eq(financialYears.councilId, councilId))
    .orderBy(desc(financialYears.label))
    .all();
}

export function getLatestFinancialYear(councilId: number) {
  return getDb()
    .select()
    .from(financialYears)
    .where(eq(financialYears.councilId, councilId))
    .orderBy(desc(financialYears.label))
    .limit(1)
    .get();
}

export function getOverview(councilId: number, fyId?: number) {
  const db = getDb();

  const totalBudget = db
    .select({
      totalNet: sql<number>`COALESCE(SUM(${budgets.netBudget}), 0)`,
      totalGross: sql<number>`COALESCE(SUM(${budgets.grossBudget}), 0)`,
    })
    .from(budgets)
    .where(fyId ? eq(budgets.financialYearId, fyId) : sql`1=1`)
    .get();

  const totalOutturn = db
    .select({
      totalOutturn: sql<number>`COALESCE(SUM(${outturns.netOutturn}), 0)`,
      totalVariance: sql<number>`COALESCE(SUM(${outturns.variance}), 0)`,
    })
    .from(outturns)
    .where(fyId ? eq(outturns.financialYearId, fyId) : sql`1=1`)
    .get();

  const spendConditions: SQL[] = [eq(transactions.councilId, councilId)];
  if (fyId) spendConditions.push(eq(transactions.financialYearId, fyId));

  const totalSpend = db
    .select({
      total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      count: sql<number>`COUNT(*)`,
      supplierCount: sql<number>`COUNT(DISTINCT ${transactions.supplierId})`,
    })
    .from(transactions)
    .where(and(...spendConditions))
    .get();

  // Year-on-year change
  let yoyChange: number | null = null;
  if (fyId) {
    const fy = db.select().from(financialYears).where(eq(financialYears.id, fyId)).get();
    if (fy) {
      const parts = fy.label.split("-");
      const prevStartYear = parseInt(parts[0]) - 1;
      const prevLabel = `${prevStartYear}-${parts[0].slice(-2)}`;
      const prevFy = db
        .select()
        .from(financialYears)
        .where(and(eq(financialYears.councilId, councilId), eq(financialYears.label, prevLabel)))
        .get();

      if (prevFy) {
        const prevSpend = db
          .select({ total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)` })
          .from(transactions)
          .where(and(eq(transactions.councilId, councilId), eq(transactions.financialYearId, prevFy.id)))
          .get();
        if (prevSpend && prevSpend.total > 0) {
          yoyChange = (((totalSpend?.total ?? 0) - prevSpend.total) / prevSpend.total) * 100;
        }
      }
    }
  }

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

export function getTransactions(councilId: number, filters: TransactionFilters) {
  const db = getDb();
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [eq(transactions.councilId, councilId)];

  if (filters.fyId) conditions.push(eq(transactions.financialYearId, filters.fyId));
  if (filters.directorate) conditions.push(eq(transactions.directorate, filters.directorate));
  if (filters.category) conditions.push(eq(transactions.category, filters.category));
  if (filters.minAmount) conditions.push(gte(transactions.amount, filters.minAmount));
  if (filters.maxAmount) conditions.push(lte(transactions.amount, filters.maxAmount));
  if (filters.startDate) conditions.push(gte(transactions.date, filters.startDate));
  if (filters.endDate) conditions.push(lte(transactions.date, filters.endDate));
  if (filters.search) {
    conditions.push(
      sql`(${transactions.description} LIKE ${"%" + filters.search + "%"} OR ${transactions.service} LIKE ${"%" + filters.search + "%"})`
    );
  }

  const where = and(...conditions)!;

  const sortColumn = (() => {
    switch (filters.sortBy) {
      case "amount": return transactions.amount;
      case "date": return transactions.date;
      case "supplier": return transactions.supplierId;
      case "directorate": return transactions.directorate;
      default: return transactions.amount;
    }
  })();
  const order = filters.sortDir === "asc" ? asc(sortColumn) : desc(sortColumn);

  const rows = db
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
    })
    .from(transactions)
    .leftJoin(suppliers, eq(transactions.supplierId, suppliers.id))
    .leftJoin(sourceDocuments, eq(transactions.sourceDocumentId, sourceDocuments.id))
    .where(where)
    .orderBy(order)
    .limit(pageSize)
    .offset(offset)
    .all();

  const countResult = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(where)
    .get();

  return {
    rows,
    total: countResult?.count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((countResult?.count ?? 0) / pageSize),
  };
}

export function getSpendByCategory(councilId: number, fyId?: number) {
  const db = getDb();
  const conditions: SQL[] = [eq(transactions.councilId, councilId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));

  const raw = db
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

export function getSpendByDirectorate(councilId: number, fyId?: number) {
  const db = getDb();
  const conditions: SQL[] = [eq(transactions.councilId, councilId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));

  const serviceCol = transactions.service;
  const dirCol = transactions.directorate;

  const dirResult = db
    .select({
      directorate: dirCol,
      total: sql<number>`SUM(${transactions.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(dirCol)
    .orderBy(desc(sql`SUM(${transactions.amount})`))
    .limit(15)
    .all()
    .filter((r) => r.directorate && r.directorate.trim() !== "");

  if (dirResult.length > 0) return dirResult;

  const raw = db
    .select({
      directorate: serviceCol,
      total: sql<number>`SUM(${transactions.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(serviceCol)
    .orderBy(desc(sql`SUM(${transactions.amount})`))
    .limit(15)
    .all();

  return raw.map((r) => ({
    ...r,
    directorate: r.directorate && r.directorate.trim() !== "" ? r.directorate : "No Service Area",
  }));
}

export function getTopSuppliers(councilId: number, fyId?: number, limit = 20) {
  const db = getDb();
  const conditions: SQL[] = [eq(transactions.councilId, councilId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));

  const totalSpend = db
    .select({ total: sql<number>`SUM(${transactions.amount})` })
    .from(transactions)
    .where(and(...conditions))
    .get();

  const topSuppliers = db
    .select({
      supplierId: transactions.supplierId,
      supplierName: suppliers.name,
      total: sql<number>`SUM(${transactions.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .leftJoin(suppliers, eq(transactions.supplierId, suppliers.id))
    .where(and(...conditions))
    .groupBy(transactions.supplierId)
    .orderBy(desc(sql`SUM(${transactions.amount})`))
    .limit(limit)
    .all();

  const grandTotal = totalSpend?.total ?? 1;
  return topSuppliers.map((s) => ({
    ...s,
    percentage: grandTotal > 0 ? (s.total / grandTotal) * 100 : 0,
  }));
}

export function getMonthlyTrend(councilId: number, fyId?: number) {
  const db = getDb();
  const conditions: SQL[] = [eq(transactions.councilId, councilId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));

  return db
    .select({
      month: transactions.month,
      total: sql<number>`SUM(${transactions.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.month)
    .orderBy(asc(transactions.month))
    .all()
    .filter((r) => r.month && r.month.trim() !== "");
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

export function getFlags(councilId: number, fyId?: number) {
  const db = getDb();
  const flags: { type: string; severity: "high" | "medium" | "low"; title: string; detail: string }[] = [];

  const conditions: SQL[] = [eq(transactions.councilId, councilId)];
  if (fyId) conditions.push(eq(transactions.financialYearId, fyId));
  const where = and(...conditions)!;

  const totals = db
    .select({
      total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(where)
    .get();
  const grandTotal = totals?.total ?? 1;
  const grandCount = totals?.count ?? 0;

  // --- 1. Redacted / undisclosed supplier spend ---
  const redactedSpend = db
    .select({
      total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .leftJoin(suppliers, eq(transactions.supplierId, suppliers.id))
    .where(and(
      where,
      sql`(${suppliers.name} IN ('REDACTED DATA','REDACTED PERSONAL DATA','Redacted','REDACTED','Redacted Personal Data','Redacted Commercial Confidentiality') OR ${suppliers.name} IS NULL)`
    ))
    .get();

  if (redactedSpend && redactedSpend.total > 0) {
    const pct = (redactedSpend.total / grandTotal) * 100;
    flags.push({
      type: "redacted_spend",
      severity: pct > 30 ? "high" : pct > 15 ? "medium" : "low",
      title: `${fmtAmount(redactedSpend.total)} to redacted suppliers`,
      detail: `${redactedSpend.count.toLocaleString()} payments (${pct.toFixed(0)}% of total spend) to undisclosed vendors`,
    });
  }

  // --- 2. Transactions with no category data ---
  const blankCats = db
    .select({
      total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(and(
      where,
      sql`(${transactions.category} IS NULL OR ${transactions.category} = '' OR ${transactions.category} = 'REDACTED DATA')`
    ))
    .get();

  if (blankCats && blankCats.count > 0) {
    const pct = (blankCats.total / grandTotal) * 100;
    flags.push({
      type: "missing_data",
      severity: pct > 30 ? "high" : pct > 15 ? "medium" : "low",
      title: `${fmtAmount(blankCats.total)} with no category`,
      detail: `${blankCats.count.toLocaleString()} transactions (${pct.toFixed(0)}% of spend) have blank or redacted category data`,
    });
  }

  // --- 3. Large payments (>£1M) — show named and redacted separately ---
  const bigPayments = db
    .select({
      supplierName: suppliers.name,
      normalisedName: suppliers.normalisedName,
      amount: transactions.amount,
      date: transactions.date,
      description: transactions.description,
    })
    .from(transactions)
    .leftJoin(suppliers, eq(transactions.supplierId, suppliers.id))
    .where(and(where, gte(transactions.amount, 1_000_000)))
    .orderBy(desc(transactions.amount))
    .limit(50)
    .all();

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

  // --- 4. Supplier concentration ---
  const topSuppliers = getTopSuppliers(councilId, fyId, 5);
  const top5Total = topSuppliers.reduce((sum, s) => sum + s.percentage, 0);
  if (top5Total > 40) {
    flags.push({
      type: "supplier_concentration",
      severity: "high",
      title: "High supplier concentration",
      detail: `Top 5 suppliers account for ${top5Total.toFixed(1)}% of total spend`,
    });
  } else if (top5Total > 25) {
    flags.push({
      type: "supplier_concentration",
      severity: "medium",
      title: "Moderate supplier concentration",
      detail: `Top 5 suppliers account for ${top5Total.toFixed(1)}% of total spend`,
    });
  }

  // --- 5. Category year-on-year changes ---
  if (fyId) {
    const fy = db
      .select()
      .from(financialYears)
      .where(eq(financialYears.id, fyId))
      .get();

    if (fy) {
      const parts = fy.label.split("-");
      const prevStartYear = parseInt(parts[0]) - 1;
      const prevLabel = `${prevStartYear}-${parts[0].slice(-2)}`;
      const prevFy = db
        .select()
        .from(financialYears)
        .where(
          and(
            eq(financialYears.councilId, councilId),
            eq(financialYears.label, prevLabel)
          )
        )
        .get();

      if (prevFy) {
        const currentCats = getSpendByCategory(councilId, fyId);
        const prevCats = getSpendByCategory(councilId, prevFy.id);
        const prevMap = new Map(prevCats.map((c) => [c.category, c.total]));

        const risingCats: { category: string; change: number; total: number; absolute: number }[] = [];
        for (const cat of currentCats) {
          const prev = prevMap.get(cat.category);
          if (prev && prev > 200_000 && cat.total > 200_000) {
            const change = ((cat.total - prev) / prev) * 100;
            const absolute = cat.total - prev;
            if (change > 30 && absolute > 100_000) {
              risingCats.push({ category: cat.category || "No Category", change, total: cat.total, absolute });
            }
          }
        }
        risingCats
          .sort((a, b) => b.absolute - a.absolute)
          .slice(0, 3)
          .forEach((rc) => {
            flags.push({
              type: "rising_category",
              severity: rc.change > 100 ? "high" : "medium",
              title: `Rising: ${rc.category}`,
              detail: `Up ${rc.change.toFixed(0)}% (${fmtAmount(rc.absolute)}) year-on-year`,
            });
          });
      }
    }
  }

  return flags;
}

export function getDirectoratesList(councilId: number) {
  const db = getDb();
  return db
    .select({ directorate: transactions.directorate })
    .from(transactions)
    .where(eq(transactions.councilId, councilId))
    .groupBy(transactions.directorate)
    .orderBy(asc(transactions.directorate))
    .all()
    .map((r) => r.directorate)
    .filter(Boolean) as string[];
}

export function getCategoriesList(councilId: number) {
  const db = getDb();
  return db
    .select({ category: transactions.category })
    .from(transactions)
    .where(eq(transactions.councilId, councilId))
    .groupBy(transactions.category)
    .orderBy(asc(transactions.category))
    .all()
    .map((r) => r.category)
    .filter(Boolean) as string[];
}
