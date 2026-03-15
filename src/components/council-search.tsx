"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const COUNCILS = [
  { name: "Kirklees Council", slug: "kirklees", region: "West Yorkshire" },
];

export function CouncilSearch() {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const router = useRouter();

  const filtered = COUNCILS.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.region?.toLowerCase().includes(query.toLowerCase())
  );

  const showDropdown = focused && query.length > 0 && filtered.length > 0;

  return (
    <div className="relative w-full max-w-lg">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "#9ca3af" }} />
        <input
          type="text"
          placeholder="Search for a council..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          className="h-12 w-full rounded-xl border pl-11 pr-4 text-base shadow-sm outline-none transition-all focus:ring-2 focus:ring-blue-400"
          style={{ background: "#fff", color: "#111", borderColor: "#e5e7eb" }}
        />
      </div>
      {showDropdown && (
        <div className="absolute top-full left-0 z-10 mt-1 w-full rounded-xl border shadow-lg" style={{ background: "#fff", borderColor: "#e5e7eb" }}>
          {filtered.map((c) => (
            <button
              key={c.slug}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 first:rounded-t-xl last:rounded-b-xl"
              onMouseDown={() => router.push(`/councils/${c.slug}`)}
            >
              <div>
                <div className="font-medium" style={{ color: "#111" }}>{c.name}</div>
                <div className="text-sm" style={{ color: "#6b7280" }}>{c.region}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
