import { CouncilSearch } from "@/components/council-search";
import { Building2, BarChart3, FileText, AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center gap-12 py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Building2 className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Council Spend Monitor
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Explore UK council public spending data. Budgets, outturn, suppliers,
          and every transaction over &pound;500.
        </p>
      </div>

      <CouncilSearch />

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-center">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h3 className="font-semibold">Budget &amp; Outturn</h3>
          <p className="text-sm text-muted-foreground">
            Approved budgets vs actual spend by directorate and service
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-center">
          <FileText className="h-6 w-6 text-primary" />
          <h3 className="font-semibold">Transaction Ledger</h3>
          <p className="text-sm text-muted-foreground">
            Search every public payment by supplier, amount, and date
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-warning" />
          <h3 className="font-semibold">Spending Flags</h3>
          <p className="text-sm text-muted-foreground">
            Unusual supplier concentration, rising costs, and big one-offs
          </p>
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm text-muted-foreground">MVP: starting with</p>
        <Link
          href="/councils/kirklees"
          className="text-lg font-semibold text-primary underline-offset-4 hover:underline"
        >
          Kirklees Council &rarr;
        </Link>
      </div>
    </div>
  );
}
