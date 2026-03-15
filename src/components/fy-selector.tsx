"use client";

import { useRouter } from "next/navigation";

interface FYSelectorProps {
  years: string[];
  current: string;
  slug: string;
}

export function FYSelector({ years, current, slug }: FYSelectorProps) {
  const router = useRouter();

  return (
    <select
      value={current}
      onChange={(e) => {
        const fy = e.target.value;
        router.push(`/councils/${slug}${fy ? `?fy=${fy}` : ""}`);
      }}
      className="h-9 rounded-lg border bg-card px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
