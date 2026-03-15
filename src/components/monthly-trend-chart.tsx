"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatCompact } from "@/lib/format";

interface DataItem {
  month: string | null;
  total: number;
  count: number;
}

export function MonthlyTrendChart({ data }: { data: DataItem[] }) {
  const chartData = data.map((d) => ({
    month: d.month || "",
    label: formatMonthLabel(d.month || ""),
    total: d.total,
    count: d.count,
  }));

  return (
    <div className="rounded-xl border p-5 shadow-sm" style={{ background: "#fff" }}>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
        Monthly Spend Trend
      </h3>
      {chartData.length === 0 ? (
        <p className="py-8 text-center" style={{ color: "#6b7280" }}>No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#374151" }} />
            <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 11, fill: "#374151" }} />
            <Tooltip
              formatter={(value) => [formatCompact(Number(value)), "Spend"]}
              labelFormatter={(label) => `Month: ${label}`}
              contentStyle={{ fontSize: 12, background: "#fff", border: "1px solid #e5e7eb", color: "#111" }}
              itemStyle={{ color: "#111" }}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke="#1e40af"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function formatMonthLabel(month: string): string {
  if (!month) return "";
  const [year, m] = month.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = parseInt(m) - 1;
  return `${monthNames[idx] || m} ${year?.slice(-2) || ""}`;
}
