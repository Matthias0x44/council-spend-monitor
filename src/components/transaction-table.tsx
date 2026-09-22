"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { formatCurrencyDetailed } from "@/lib/format";

interface Transaction {
  id: number;
  supplierName: string | null;
  amount: number;
  date: string | null;
  month: string | null;
  directorate: string | null;
  service: string | null;
  category: string | null;
  description: string | null;
  sourceFile: string | null;
  sourceUrl: string | null;
  serviceClassification: string;
  classificationEvidence: string | null;
}

interface ApiResponse {
  rows: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Props {
  slug: string;
  fy?: string;
  directorates: string[];
  categories: string[];
}

export function TransactionTable({ slug, fy, directorates, categories }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [directorate, setDirectorate] = useState("");
  const [category, setCategory] = useState("");
  const [sortBy, setSortBy] = useState("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (fy) params.set("fy", fy);
    params.set("page", String(page));
    params.set("pageSize", "50");
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    if (search) params.set("search", search);
    if (directorate) params.set("directorate", directorate);
    if (category) params.set("category", category);

    try {
      const res = await fetch(`/api/councils/${slug}/transactions?${params}`, { signal });
      if (!res.ok) throw new Error(`Unable to load transactions (${res.status})`);
      const json = (await res.json()) as ApiResponse;
      if (!signal.aborted) setData(json);
    } catch (err) {
      if (!signal.aborted) { setData(null); setError(err instanceof Error ? err.message : "Unable to load transactions"); }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [slug, fy, page, search, directorate, category, sortBy, sortDir]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => fetchData(controller.signal), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [slug, fy, search, directorate, category, sortBy, sortDir]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const exportCSV = () => {
    const params = new URLSearchParams({ format: "csv", sortBy, sortDir });
    if (fy) params.set("fy", fy);
    if (search) params.set("search", search);
    if (directorate) params.set("directorate", directorate);
    if (category) params.set("category", category);
    window.location.assign(`/api/councils/${slug}/transactions?${params}`);
  };

  const hasFilters = search || directorate || category;

  return (
    <div className="rounded-xl border shadow-sm" style={{ background: "#fff" }}>
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
          Transactions
        </h3>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "#9ca3af" }} />
            <input
              type="text"
              aria-label="Search suppliers and descriptions"
              placeholder="Supplier or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 rounded-lg border pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-400"
              style={{ background: "#fff", color: "#111", borderColor: "#e5e7eb" }}
            />
          </div>
          <select
            aria-label="Filter directorate"
            value={directorate}
            onChange={(e) => setDirectorate(e.target.value)}
            className="h-8 max-w-full rounded-lg border px-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            style={{ background: "#fff", color: "#111", borderColor: "#e5e7eb" }}
          >
            <option value="">All directorates</option>
            {directorates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 max-w-full rounded-lg border px-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            style={{ background: "#fff", color: "#111", borderColor: "#e5e7eb" }}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={() => {
                setSearch("");
                setDirectorate("");
                setCategory("");
              }}
              className="flex h-8 items-center gap-1 rounded-lg border px-2 text-sm hover:bg-gray-50"
              style={{ color: "#6b7280", borderColor: "#e5e7eb" }}
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
          <button
            onClick={exportCSV}
            disabled={loading || !data?.total}
            className="flex h-8 items-center gap-1 rounded-lg border px-3 text-sm font-medium hover:bg-gray-50"
            style={{ color: "#111", borderColor: "#e5e7eb" }}
          >
            <Download className="h-3 w-3" /> Export all matching
          </button>
        </div>
      </div>

      {error && <p role="alert" className="p-4 text-red-700">{error}. Change a filter or reload to retry.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ color: "#111" }}>
          <thead>
            <tr className="border-b" style={{ background: "#f9fafb" }}>
              <SortHeader label="Supplier" col="supplier" current={sortBy} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Amount" col="amount" current={sortBy} dir={sortDir} onSort={handleSort} className="text-right" />
              <SortHeader label="Date" col="date" current={sortBy} dir={sortDir} onSort={handleSort} />
              <th className="px-3 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Directorate</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Service</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Service classification</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Description</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center" style={{ color: "#6b7280" }}>
                  Loading...
                </td>
              </tr>
            ) : !data || data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center" style={{ color: "#6b7280" }}>
                  No transactions found
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.id} className="border-b transition-colors hover:bg-gray-50">
                  <td className="max-w-[200px] truncate px-3 py-2 font-medium" title={row.supplierName || ""}>
                    {row.supplierName || "\u2014"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                    {formatCurrencyDetailed(row.amount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2" style={{ color: "#6b7280" }}>
                    {row.date || row.month || "\u2014"}
                  </td>
                  <td className="max-w-[150px] truncate px-3 py-2" title={row.directorate || ""}>{row.directorate || "\u2014"}</td>
                  <td className="max-w-[150px] truncate px-3 py-2" title={row.service || ""}>{row.service || "\u2014"}</td>
                  <td className="max-w-[180px] px-3 py-2" title={row.classificationEvidence || ""}>{row.serviceClassification}</td>
                  <td className="max-w-[200px] truncate px-3 py-2" style={{ color: "#6b7280" }} title={row.description || ""}>
                    {row.description || "\u2014"}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 text-xs" style={{ color: "#9ca3af" }} title={row.sourceFile || ""}>
                    {row.sourceUrl && /^https?:\/\//.test(row.sourceUrl) ? <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Original source</a> : row.sourceFile || "\u2014"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className="text-sm" style={{ color: "#6b7280" }}>
            {((data.page - 1) * data.pageSize + 1).toLocaleString()}
            {" - "}
            {Math.min(data.page * data.pageSize, data.total).toLocaleString()} of{" "}
            {data.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              aria-label="Previous page"
              disabled={data.page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border hover:bg-gray-50 disabled:opacity-30"
              style={{ borderColor: "#e5e7eb" }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-sm" style={{ color: "#374151" }}>
              {data.page} / {data.totalPages}
            </span>
            <button
              aria-label="Next page"
              disabled={data.page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border hover:bg-gray-50 disabled:opacity-30"
              style={{ borderColor: "#e5e7eb" }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  col,
  current,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  col: string;
  current: string;
  dir: "asc" | "desc";
  onSort: (col: string) => void;
  className?: string;
}) {
  const active = current === col;
  return (
    <th
      className={`cursor-pointer select-none px-3 py-2 text-left font-medium hover:text-gray-900 ${className}`}
      style={{ color: active ? "#111" : "#6b7280" }}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => onSort(col)}>{label}</button>
      {active && <span className="ml-1">{dir === "asc" ? "\u25B2" : "\u25BC"}</span>}
    </th>
  );
}
