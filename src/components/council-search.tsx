"use client";

import { useState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

interface Council {
  id: number;
  name: string;
  slug: string;
  region: string | null;
  hasPayments: boolean;
}

export function CouncilSearch({ initialCouncils }: { initialCouncils?: Council[] }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [councils, setCouncils] = useState<Council[]>(initialCouncils ?? []);
  const [loading, setLoading] = useState(!initialCouncils);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(-1);
  const listId = useId();
  const router = useRouter();

  useEffect(() => {
    if (initialCouncils) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch("/api/councils?summary=1", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error("Council search unavailable"); return r.json() as Promise<Council[]>; })
      .then((data) => setCouncils(data))
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialCouncils, attempt]);

  const filtered = councils.filter(
    (c) =>
      (c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.region?.toLowerCase().includes(query.toLowerCase()))
  );

  const showDropdown = focused && query.length > 0;

  return (
    <div className="relative w-full max-w-lg" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2"
          style={{ color: "#9ca3af" }}
        />
        <input
          type="text"
          aria-label="Search councils"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listId : undefined}
          aria-activedescendant={showDropdown && selected >= 0 && filtered[selected] ? `${listId}-${selected}` : undefined}
          placeholder="Search for a council..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(-1); setFocused(true); }}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setFocused(false); setSelected(-1); }
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && filtered.length) {
              event.preventDefault();
              setFocused(true);
              const next = event.key === "ArrowDown" ? (selected + 1) % filtered.length : (selected <= 0 ? filtered.length - 1 : selected - 1);
              setSelected(next);
              requestAnimationFrame(() => document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" }));
            }
            if (event.key === "Enter" && showDropdown && selected >= 0 && filtered[selected]) {
              event.preventDefault();
              router.push(`/councils/${filtered[selected].slug}`);
            }
          }}
          className="h-12 w-full rounded-xl border pl-11 pr-4 text-base shadow-sm outline-none transition-all focus:ring-2 focus:ring-blue-400"
          style={{ background: "#fff", color: "#111", borderColor: "#e5e7eb" }}
        />
      </div>
      {showDropdown && (
        <div
          className="absolute top-full left-0 z-10 mt-1 w-full rounded-xl border shadow-lg max-h-80 overflow-y-auto"
          style={{ background: "#fff", borderColor: "#e5e7eb" }}
        >
          <div role="status" className="px-4 text-sm text-gray-600">
            {loading ? <p className="py-3">Loading councils…</p> : error ? <p className="py-3">Council search is unavailable. <button className="underline" onClick={() => setAttempt(n => n + 1)}>Try again</button></p> : filtered.length === 0 ? <p className="py-3">No matching councils.</p> : null}
          </div>
          <div id={listId} role="listbox" aria-label="Matching councils">
          {!loading && !error && filtered.map((c, index) => (
            <button
              key={c.slug}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={selected === index}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 first:rounded-t-xl last:rounded-b-xl ${selected === index ? "bg-blue-50" : ""}`}
              onClick={() => router.push(`/councils/${c.slug}`)}
            >
              <div>
                <div className="font-medium" style={{ color: "#111" }}>
                  {c.name}
                </div>
                <div className="text-sm" style={{ color: "#6b7280" }}>
                  {c.region}
                </div>
              </div>
              {c.hasPayments && (
                <div
                  className="text-xs whitespace-nowrap"
                  style={{ color: "#6b7280" }}
                >
                  Payments available
                </div>
              )}
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
