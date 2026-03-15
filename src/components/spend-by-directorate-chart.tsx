"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatCompact } from "@/lib/format";

interface DataItem {
  directorate: string | null;
  total: number;
  count: number;
}

const COLORS = [
  "#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd",
  "#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd",
];

export function SpendByDirectorateChart({ data }: { data: DataItem[] }) {
  const chartData = data.slice(0, 10).map((d) => ({
    name: truncate(d.directorate || "Unknown", 30),
    value: d.total,
    count: d.count,
  }));

  return (
    <div className="rounded-xl border p-5 shadow-sm" style={{ background: "#fff" }}>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
        Top Service Areas
      </h3>
      {chartData.length === 0 ? (
        <p className="py-8 text-center" style={{ color: "#6b7280" }}>No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
            <XAxis
              type="number"
              tickFormatter={(v) => formatCompact(v)}
              tick={{ fontSize: 11, fill: "#374151" }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={160}
              tick={{ fontSize: 11, fill: "#374151" }}
            />
            <Tooltip
              formatter={(value) => [formatCompact(Number(value)), "Spend"]}
              contentStyle={{ fontSize: 12, background: "#fff", border: "1px solid #e5e7eb", color: "#111" }}
              itemStyle={{ color: "#111" }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}
