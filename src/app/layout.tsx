import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Council Spend Monitor",
  description: "Explore published English council payments with original sources and transparent coverage.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" style={{ colorScheme: "light" }}>
      <body className="antialiased min-h-screen" style={{ background: "#ffffff", color: "#111111" }}>
        <header className="sticky top-0 z-50 border-b bg-white/90 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link href="/" className="font-semibold" style={{ color: "#1d4ed8" }}>
              Council Spend Monitor
            </Link>
            <Link
              href="/councils"
              className="text-sm transition-colors hover:underline"
              style={{ color: "#6b7280" }}
            >
              All Councils
            </Link>
          </div>
        </header>
        <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-center text-sm text-blue-950">
          Portfolio sample · 272 selected payments from 9 councils · frozen September 2026 · no live updates
        </div>
        <main className="mx-auto max-w-7xl px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
