import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the archived sample's five-year window reproducible in future years.
  env: { PORTFOLIO_AS_OF: "2026-09-25T12:00:00Z" },
  outputFileTracingRoot: process.cwd(),
  // better-sqlite3 is a native node module that we only require under
  // `next dev` / `next build` (not in the Cloudflare Workers runtime).
  // Telling Next not to bundle it keeps the Workers build smaller and
  // avoids webpack trying to resolve its native bindings.
  serverExternalPackages: ["better-sqlite3"],
  // Keep local sample and archived source data out of the traced server
  // bundle. A Worker would read from its D1 binding; including the SQLite
  // file and CSVs in `.open-next` would waste space. Scope this to `data/` —
  // excluding `.next/**` would strip the webpack/turbopack runtime chunks
  // that copyTracedFiles must copy, breaking the esbuild bundle.
  outputFileTracingExcludes: {
    "*": ["data/**"],
  },
  // Next requires these metadata helpers via dynamic `require()` strings that
  // @vercel/nft can't statically resolve, so they're left out of the traced
  // server bundle and OpenNext's esbuild pass fails with "Could not resolve
  // ../lib/metadata/{is,get}-metadata-route". Force them (the whole metadata
  // dir, to be safe) into the trace.
  outputFileTracingIncludes: {
    "**/*": ["./node_modules/next/dist/lib/metadata/**"],
  },
};

export default nextConfig;

// Optionally initialize the Cloudflare context for `next dev`, so server
// components can call `getCloudflareContext()` and hit a local D1
// simulator. The portfolio demo leaves this off and uses data/demo.db.
if (process.env.USE_CF_DEV === "1") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");
  initOpenNextCloudflareForDev();
}
