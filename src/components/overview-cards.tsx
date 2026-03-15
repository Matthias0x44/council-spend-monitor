import { formatCompact } from "@/lib/format";
import { PoundSterling, TrendingUp, TrendingDown, Receipt, ArrowUpDown } from "lucide-react";

interface Overview {
  budget: { net: number; gross: number };
  outturn: { net: number; variance: number };
  spend: { total: number; transactionCount: number };
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

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {hasBudget ? (
        <Card
          label="Net Budget"
          value={formatCompact(overview.budget.net)}
          sub={overview.budget.gross ? `Gross: ${formatCompact(overview.budget.gross)}` : undefined}
          icon={<PoundSterling className="h-4 w-4" />}
          accent="primary"
        />
      ) : (
        <Card
          label="Net Budget"
          value="No data"
          sub="Budget PDF not yet ingested"
          icon={<PoundSterling className="h-4 w-4" />}
          accent="primary"
        />
      )}

      {hasOutturn ? (
        <Card
          label="Outturn"
          value={formatCompact(overview.outturn.net)}
          icon={<Receipt className="h-4 w-4" />}
          accent="primary"
        />
      ) : (
        <Card
          label="Recorded Spend"
          value={formatCompact(overview.spend.total)}
          sub={`${overview.spend.transactionCount.toLocaleString()} transactions (>£500)`}
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
      ) : (
        <Card
          label="Variance"
          value={hasBudget && overview.spend.total ? formatCompact(overview.spend.total - overview.budget.net) : "N/A"}
          sub={hasBudget ? "Spend vs budget" : undefined}
          icon={<ArrowUpDown className="h-4 w-4" />}
          accent="muted"
        />
      )}

      <Card
        label="Transactions"
        value={overview.spend.transactionCount.toLocaleString()}
        sub={`Total: ${formatCompact(overview.spend.total)}`}
        icon={<Receipt className="h-4 w-4" />}
        accent="primary"
      />
    </div>
  );
}

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
  const accentClasses = {
    primary: "text-primary",
    destructive: "text-destructive",
    success: "text-success",
    muted: "text-muted-foreground",
  };

  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={accentClasses[accent]}>{icon}</span>
        {label}
      </div>
      <div className={`text-2xl font-bold ${accentClasses[accent]}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
