import { AlertTriangle, TrendingUp, Banknote } from "lucide-react";

interface Flag {
  type: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

const ICONS: Record<string, React.ReactNode> = {
  supplier_concentration: <AlertTriangle className="h-4 w-4" />,
  rising_category: <TrendingUp className="h-4 w-4" />,
  large_payment: <Banknote className="h-4 w-4" />,
};

const SEVERITY_STYLES: Record<string, string> = {
  high: "border-destructive/30 bg-destructive/5 text-destructive",
  medium: "border-warning/30 bg-warning/5 text-warning",
  low: "border-muted bg-muted/50 text-muted-foreground",
};

export function FlagsPanel({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Spending Flags
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {flags.map((flag, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 rounded-lg border p-3 ${SEVERITY_STYLES[flag.severity]}`}
          >
            <span className="mt-0.5 shrink-0">
              {ICONS[flag.type] || <AlertTriangle className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-tight">{flag.title}</div>
              <div className="mt-0.5 text-xs opacity-80">{flag.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
