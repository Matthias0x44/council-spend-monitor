import { getCouncilDirectory } from "@/lib/queries";
import Link from "next/link";
import { CouncilSearch } from "@/components/council-search";

export const dynamic = "force-dynamic";

export default async function CouncilsPage() {
  const active = await getCouncilDirectory();

  const regions = [...new Set(active.map((c) => c.region).filter(Boolean))].sort();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold" style={{ color: "#111" }}>
          All Councils
        </h1>
        <p className="text-sm" style={{ color: "#6b7280" }}>
          {active.length} English authorities in the retained period; {active.filter(c => c.hasPayments).length} with ingested payments
        </p>
      </div>

      <div className="max-w-lg">
        <CouncilSearch initialCouncils={active} />
      </div>

      {active.length > 0 && (
        <div className="flex flex-col gap-6">
          <h2 className="text-lg font-semibold" style={{ color: "#111" }}>
            Council coverage
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
                        {(
                          <div className="text-xs" style={{ color: "#6b7280" }}>
                            {c.hasPayments ? "Payments available · partial coverage" : "No data ingested"}
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
                        {(
                          <div className="text-xs" style={{ color: "#6b7280" }}>
                            {c.hasPayments ? "Payments available · partial coverage" : "No data ingested"}
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

    </div>
  );
}
