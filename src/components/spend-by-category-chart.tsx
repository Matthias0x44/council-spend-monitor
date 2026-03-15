"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatCompact } from "@/lib/format";

interface DataItem {
  category: string | null;
  total: number;
  count: number;
}

const COLORS = [
  "#1e40af", "#7c3aed", "#db2777", "#dc2626", "#ea580c",
  "#d97706", "#16a34a", "#0891b2", "#4f46e5", "#6366f1",
  "#8b5cf6", "#a855f7", "#c026d3", "#e11d48", "#f97316",
];

export function SpendByCategoryChart({ data }: { data: DataItem[] }) {
  const top = data.slice(0, 10);
  const otherTotal = data.slice(10).reduce((sum, d) => sum + d.total, 0);

  const chartData = [
    ...top.map((d) => ({
      name: truncate(d.category || "Unknown", 25),
      value: d.total,
    })),
    ...(otherTotal > 0 ? [{ name: "Other", value: otherTotal }] : []),
  ];

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Spend by Category
      </h3>
      {chartData.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              outerRadius={100}
              dataKey="value"
              label={({ name, percent }) =>
                `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
              }
              labelLine={false}
              fontSize={10}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatCompact(Number(value))}
              contentStyle={{ fontSize: 12, background: "#fff", border: "1px solid #e5e7eb" }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}
