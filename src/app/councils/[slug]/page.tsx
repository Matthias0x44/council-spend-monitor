import { notFound } from "next/navigation";
import {
  getCouncilBySlug,
  getOverview,
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

  const fyId = targetFY?.id;

  const overview = await getOverview(council.id, fyId);
  const byCategory = await getSpendByCategory(council.id, fyId);
  const byDirectorate = await getSpendByDirectorate(council.id, fyId);
  const topSuppliers = await getTopSuppliers(council.id, fyId, 20);
  const monthlyTrend = await getMonthlyTrend(council.id, fyId);
  const flags = await getFlags(council.id, fyId);
  const directorates = await getDirectoratesList(council.id);
  const categories = await getCategoriesList(council.id);

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

      <OverviewCards
        overview={overview}
        financialYear={targetFY?.label ?? "All years"}
      />

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
