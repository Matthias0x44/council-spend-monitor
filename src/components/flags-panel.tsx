import { AlertTriangle, TrendingUp, Banknote, EyeOff, FileQuestion } from "lucide-react";

interface Flag {
  type: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

const ICONS: Record<string, React.ReactNode> = {
  redacted_spend: <EyeOff className="h-4 w-4" />,
  missing_data: <FileQuestion className="h-4 w-4" />,
  supplier_concentration: <AlertTriangle className="h-4 w-4" />,
  rising_category: <TrendingUp className="h-4 w-4" />,
  large_payment: <Banknote className="h-4 w-4" />,
};

const SEVERITY_STYLES: Record<string, { border: string; bg: string; color: string }> = {
  high: { border: "#fecaca", bg: "#fef2f2", color: "#dc2626" },
  medium: { border: "#fed7aa", bg: "#fffbeb", color: "#d97706" },
  low: { border: "#e5e7eb", bg: "#f9fafb", color: "#6b7280" },
};

export function FlagsPanel({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;

  return (
    <div className="rounded-xl border p-5 shadow-sm" style={{ background: "#fff" }}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
        Spending Flags
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {flags.map((flag, i) => {
          const s = SEVERITY_STYLES[flag.severity] || SEVERITY_STYLES.low;
          return (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border p-3"
              style={{ borderColor: s.border, background: s.bg, color: s.color }}
            >
              <span className="mt-0.5 shrink-0">
                {ICONS[flag.type] || <AlertTriangle className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium leading-tight">{flag.title}</div>
                <div className="mt-0.5 text-xs opacity-80" style={{ color: "#374151" }}>{flag.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
