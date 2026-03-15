import { CouncilSearch } from "@/components/council-search";
import { Building2, BarChart3, FileText, AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center gap-12 py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: "#eff6ff" }}>
          <Building2 className="h-8 w-8" style={{ color: "#1d4ed8" }} />
        </div>
        <h1 className="text-4xl font-bold tracking-tight" style={{ color: "#111" }}>
          Council Spend Monitor
        </h1>
        <p className="max-w-md text-lg" style={{ color: "#6b7280" }}>
          Explore UK council public spending data. Budgets, outturn, suppliers,
          and every transaction over &pound;500.
        </p>
      </div>

      <CouncilSearch />

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        <div className="flex flex-col items-center gap-2 rounded-xl border p-6 text-center" style={{ background: "#fff", borderColor: "#e5e7eb" }}>
          <BarChart3 className="h-6 w-6" style={{ color: "#1d4ed8" }} />
          <h3 className="font-semibold" style={{ color: "#111" }}>Budget &amp; Outturn</h3>
          <p className="text-sm" style={{ color: "#6b7280" }}>
            Approved budgets vs actual spend by directorate and service
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-xl border p-6 text-center" style={{ background: "#fff", borderColor: "#e5e7eb" }}>
          <FileText className="h-6 w-6" style={{ color: "#1d4ed8" }} />
          <h3 className="font-semibold" style={{ color: "#111" }}>Transaction Ledger</h3>
          <p className="text-sm" style={{ color: "#6b7280" }}>
            Search every public payment by supplier, amount, and date
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-xl border p-6 text-center" style={{ background: "#fff", borderColor: "#e5e7eb" }}>
          <AlertTriangle className="h-6 w-6" style={{ color: "#d97706" }} />
          <h3 className="font-semibold" style={{ color: "#111" }}>Spending Flags</h3>
          <p className="text-sm" style={{ color: "#6b7280" }}>
            Unusual supplier concentration, rising costs, and big one-offs
          </p>
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm" style={{ color: "#6b7280" }}>MVP: starting with</p>
        <Link
          href="/councils/kirklees"
          className="text-lg font-semibold underline-offset-4 hover:underline"
          style={{ color: "#1d4ed8" }}
        >
          Kirklees Council &rarr;
        </Link>
      </div>
    </div>
  );
}
