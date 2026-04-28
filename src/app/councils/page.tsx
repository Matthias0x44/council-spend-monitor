import { db } from "@/db";
import { councils, transactions } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import Link from "next/link";
import { CouncilSearch } from "@/components/council-search";

export const dynamic = "force-dynamic";

export default async function CouncilsPage() {
  const allCouncils = await db
    .select({
      id: councils.id,
      name: councils.name,
      slug: councils.slug,
      region: councils.region,
      scrapeStatus: councils.scrapeStatus,
      lastScrapedAt: councils.lastScrapedAt,
      transactionCount: sql<number>`(
        SELECT COUNT(*) FROM transactions WHERE transactions.council_id = ${councils.id}
      )`,
    })
    .from(councils)
    .orderBy(councils.name)
    .all();

  const active = allCouncils.filter((c) => c.scrapeStatus === "active");
  const pending = allCouncils.filter((c) => c.scrapeStatus === "pending");
  const failing = allCouncils.filter((c) => c.scrapeStatus === "failing");

  const regions = [...new Set(active.map((c) => c.region).filter(Boolean))].sort();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold" style={{ color: "#111" }}>
          All Councils
        </h1>
        <p className="text-sm" style={{ color: "#6b7280" }}>
          {active.length} councils with data, {pending.length} coming soon
        </p>
      </div>

      <div className="max-w-lg">
        <CouncilSearch />
      </div>

      {active.length > 0 && (
        <div className="flex flex-col gap-6">
          <h2 className="text-lg font-semibold" style={{ color: "#111" }}>
            Available
          </h2>
          {regions.map((region) => {
            const regionCouncils = active.filter((c) => c.region === region);
            if (regionCouncils.length === 0) return null;
            return (
              <div key={region} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium" style={{ color: "#6b7280" }}>
                  {region}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {regionCouncils.map((c) => (
                    <Link
                      key={c.slug}
                      href={`/councils/${c.slug}`}
                      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-gray-50"
                      style={{ background: "#fff", borderColor: "#e5e7eb" }}
                    >
                      <div>
                        <div className="font-medium" style={{ color: "#111" }}>
                          {c.name}
                        </div>
                        {c.transactionCount > 0 && (
                          <div className="text-xs" style={{ color: "#6b7280" }}>
                            {c.transactionCount.toLocaleString()} transactions
                          </div>
                        )}
                      </div>
                      <span style={{ color: "#1d4ed8" }}>&rarr;</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Active councils without a region */}
          {active.filter((c) => !c.region).length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium" style={{ color: "#6b7280" }}>
                Other
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {active
                  .filter((c) => !c.region)
                  .map((c) => (
                    <Link
                      key={c.slug}
                      href={`/councils/${c.slug}`}
                      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-gray-50"
                      style={{ background: "#fff", borderColor: "#e5e7eb" }}
                    >
                      <div>
                        <div className="font-medium" style={{ color: "#111" }}>
                          {c.name}
                        </div>
                        {c.transactionCount > 0 && (
                          <div className="text-xs" style={{ color: "#6b7280" }}>
                            {c.transactionCount.toLocaleString()} transactions
                          </div>
                        )}
                      </div>
                      <span style={{ color: "#1d4ed8" }}>&rarr;</span>
                    </Link>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold" style={{ color: "#111" }}>
            Coming Soon
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pending.map((c) => (
              <div
                key={c.slug}
                className="rounded-lg border p-3 opacity-60"
                style={{ background: "#f9fafb", borderColor: "#e5e7eb" }}
              >
                <div className="text-sm font-medium" style={{ color: "#111" }}>
                  {c.name}
                </div>
                {c.region && (
                  <div className="text-xs" style={{ color: "#9ca3af" }}>
                    {c.region}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
