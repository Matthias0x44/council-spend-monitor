// All API routes hit D1/SQLite at request time, not during `next build`.
export const dynamic = "force-dynamic";

export default function ApiLayout({ children }: { children: React.ReactNode }) {
  return children;
}
