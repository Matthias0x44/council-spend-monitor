import { formatCompact } from "@/lib/format";

interface SupplierItem {
  supplierId: number | null;
  supplierName: string | null;
  total: number;
  count: number;
  percentage: number;
}

export function SupplierRanking({ data }: { data: SupplierItem[] }) {
  const maxTotal = data.length > 0 ? data[0].total : 1;

  return (
    <div className="rounded-xl border p-5 shadow-sm" style={{ background: "#fff" }}>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
        Top Suppliers
      </h3>
      {data.length === 0 ? (
        <p className="py-8 text-center" style={{ color: "#6b7280" }}>No data available</p>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 300 }}>
          {data.map((s, i) => (
            <div key={s.supplierId ?? i} className="flex items-center gap-3">
              <span className="w-6 text-right text-xs font-medium" style={{ color: "#6b7280" }}>
                {i + 1}
              </span>
              <div className="flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium" style={{ color: "#111" }}>
                    {s.supplierName || "Unknown"}
                  </span>
                  <span className="shrink-0 text-xs" style={{ color: "#6b7280" }}>
                    {formatCompact(s.total)} ({s.percentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full" style={{ background: "#f3f4f6" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(s.total / maxTotal) * 100}%`, background: "#1d4ed8" }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
