import { notFound } from "next/navigation";
import {
  getCouncilBySlug,
  getOverview,
  getCoverage,
  getFinancialYears,
  getLatestFinancialYear,
  getSpendByCategory,
  getSpendByDirectorate,
  getTopSuppliers,
  getMonthlyTrend,
  getFlags,
  getDirectoratesList,
  getCategoriesList,
} from "@/lib/queries";
import { OverviewCards } from "@/components/overview-cards";
import { SpendByCategoryChart } from "@/components/spend-by-category-chart";
import { SpendByDirectorateChart } from "@/components/spend-by-directorate-chart";
import { SupplierRanking } from "@/components/supplier-ranking";
import { MonthlyTrendChart } from "@/components/monthly-trend-chart";
import { FlagsPanel } from "@/components/flags-panel";
import { TransactionTable } from "@/components/transaction-table";
import { FYSelector } from "@/components/fy-selector";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ fy?: string }>;
}

export default async function CouncilDashboard({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { fy: fyParam } = await searchParams;

  const council = await getCouncilBySlug(slug);
  if (!council) notFound();

  const allFYs = await getFinancialYears(council.id);
  const targetFY = fyParam
    ? allFYs.find((fy) => fy.label === fyParam)
    : await getLatestFinancialYear(council.id);

  if (fyParam && !targetFY) notFound();
  if (!targetFY) return <div className="rounded-xl border bg-white p-6"><h1 className="text-2xl font-bold">{council.name}</h1><p className="mt-3">No verified transaction data is available in the five-year window. This does not mean the council spent nothing.</p></div>;
  const fyId = targetFY.id;
  const coverage = await getCoverage(council.id, fyId);

  const [overview, byCategory, byDirectorate, topSuppliers, monthlyTrend, flags, directorates, categories] =
    await Promise.all([
      getOverview(council.id, fyId),
      getSpendByCategory(council.id, fyId),
      getSpendByDirectorate(council.id, fyId),
      getTopSuppliers(council.id, fyId, 20),
      getMonthlyTrend(council.id, fyId),
      getFlags(council.id, fyId),
      getDirectoratesList(council.id),
      getCategoriesList(council.id),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#111" }}>{council.name}</h1>
          <p className="text-sm" style={{ color: "#6b7280" }}>{council.region}</p>
        </div>
        <FYSelector
          years={allFYs.map((fy) => fy.label)}
          current={targetFY?.label ?? ""}
          slug={slug}
        />
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Partial published-payment data · {coverage.months} months observed in {targetFY.label}</strong>
        <p className="mt-1">{coverage.firstMonth} to {coverage.lastMonth}. Missing months are unknown, not zero. Published payments exclude items such as payroll and are not the council’s total expenditure. Refunds reduce the net total.</p>
        <p className="mt-1">Original categories are supplied by the council. Service labels are automated suggestions; ambiguous records remain unclassified. Accuracy has not yet been independently measured.</p>
      </div>
      <OverviewCards overview={overview} />

      {flags.length > 0 && <FlagsPanel flags={flags} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <SpendByDirectorateChart data={byDirectorate} />
        <SpendByCategoryChart data={byCategory} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MonthlyTrendChart data={monthlyTrend} />
        <SupplierRanking data={topSuppliers} />
      </div>

      <TransactionTable
        slug={slug}
        fy={targetFY?.label}
        directorates={directorates}
        categories={categories}
      />
    </div>
  );
}
