import { formatCompact, formatCurrency } from "@/lib/format";
import { PoundSterling, TrendingUp, TrendingDown, Receipt, Users, ArrowUpDown } from "lucide-react";

interface Overview {
  budget: { net: number; gross: number };
  outturn: { net: number; variance: number };
  spend: { total: number; transactionCount: number };
  supplierCount?: number;
  avgTransaction?: number;
  yoyChange?: number | null;
}

interface Props {
  overview: Overview;
  financialYear: string;
}

export function OverviewCards({ overview, financialYear }: Props) {
  const hasBudget = overview.budget.net !== 0 || overview.budget.gross !== 0;
  const hasOutturn = overview.outturn.net !== 0;
  const variance = overview.outturn.variance;
  const isOverspend = variance > 0;
  const avg = overview.spend.transactionCount > 0
    ? overview.spend.total / overview.spend.transactionCount
    : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Total Spend"
        value={formatCompact(overview.spend.total)}
        sub={`${overview.spend.transactionCount.toLocaleString()} transactions`}
        icon={<PoundSterling className="h-4 w-4" />}
        accent="primary"
      />

      {hasBudget ? (
        <Card
          label="Net Budget"
          value={formatCompact(overview.budget.net)}
          sub={overview.budget.gross ? `Gross: ${formatCompact(overview.budget.gross)}` : undefined}
          icon={<Receipt className="h-4 w-4" />}
          accent="primary"
        />
      ) : (
        <Card
          label="Avg Transaction"
          value={formatCurrency(avg)}
          sub="Per payment (>£500)"
          icon={<Receipt className="h-4 w-4" />}
          accent="primary"
        />
      )}

      {hasOutturn && variance !== 0 ? (
        <Card
          label={isOverspend ? "Overspend" : "Underspend"}
          value={formatCompact(Math.abs(variance))}
          icon={isOverspend ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          accent={isOverspend ? "destructive" : "success"}
        />
      ) : overview.yoyChange != null ? (
        <Card
          label="Year-on-Year"
          value={`${overview.yoyChange > 0 ? "+" : ""}${overview.yoyChange.toFixed(1)}%`}
          sub="vs previous year"
          icon={overview.yoyChange > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          accent={Math.abs(overview.yoyChange) > 10 ? "destructive" : "muted"}
        />
      ) : (
        <Card
          label="Year-on-Year"
          value="—"
          sub="No prior year data"
          icon={<ArrowUpDown className="h-4 w-4" />}
          accent="muted"
        />
      )}

      <Card
        label="Suppliers"
        value={(overview.supplierCount ?? 0).toLocaleString()}
        sub="Unique suppliers paid"
        icon={<Users className="h-4 w-4" />}
        accent="primary"
      />
    </div>
  );
}

const ACCENT_COLORS = {
  primary: "#1d4ed8",
  destructive: "#dc2626",
  success: "#16a34a",
  muted: "#6b7280",
};

function Card({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: "primary" | "destructive" | "success" | "muted";
}) {
  const color = ACCENT_COLORS[accent];

  return (
    <div className="flex flex-col gap-1 rounded-xl border p-5 shadow-sm" style={{ background: "#fff" }}>
      <div className="flex items-center gap-2 text-sm" style={{ color: "#6b7280" }}>
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: "#6b7280" }}>{sub}</div>}
    </div>
  );
}
