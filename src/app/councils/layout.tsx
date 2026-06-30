// Council pages query the database on every request.
export const dynamic = "force-dynamic";

export default function CouncilsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
