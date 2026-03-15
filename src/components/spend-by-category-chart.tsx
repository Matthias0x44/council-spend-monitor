"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";
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

const RADIAN = Math.PI / 180;

function renderCustomLabel(props: PieLabelRenderProps) {
  const cx = Number(props.cx ?? 0);
  const cy = Number(props.cy ?? 0);
  const midAngle = Number(props.midAngle ?? 0);
  const outerRadius = Number(props.outerRadius ?? 0);
  const percent = Number(props.percent ?? 0);
  const name = String(props.name ?? "");

  if (percent < 0.06) return null;

  const radius = outerRadius + 20;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#111111"
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={500}
    >
      {truncate(name, 20)} ({(percent * 100).toFixed(0)}%)
    </text>
  );
}

export function SpendByCategoryChart({ data }: { data: DataItem[] }) {
  const top = data.slice(0, 8);
  const otherTotal = data.slice(8).reduce((sum, d) => sum + d.total, 0);

  const chartData = [
    ...top.map((d) => ({
      name: truncate(d.category || "Unknown", 25),
      value: d.total,
    })),
    ...(otherTotal > 0 ? [{ name: "Other", value: otherTotal }] : []),
  ];

  return (
    <div className="rounded-xl border p-5 shadow-sm" style={{ background: "#fff" }}>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
        Spend by Category
      </h3>
      {chartData.length === 0 ? (
        <p className="py-8 text-center" style={{ color: "#6b7280" }}>No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={380}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="45%"
              outerRadius={110}
              innerRadius={40}
              dataKey="value"
              label={renderCustomLabel}
              labelLine={false}
              paddingAngle={1}
              strokeWidth={1}
              stroke="#ffffff"
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatCompact(Number(value))}
              contentStyle={{ fontSize: 12, background: "#fff", border: "1px solid #e5e7eb", color: "#111" }}
              itemStyle={{ color: "#111" }}
            />
            <Legend
              layout="horizontal"
              verticalAlign="bottom"
              align="center"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: "#111", paddingTop: 8 }}
              formatter={(value) => <span style={{ color: "#374151" }}>{value}</span>}
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
