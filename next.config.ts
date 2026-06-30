import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native node module that we only require under
  // `next dev` / `next build` (not in the Cloudflare Workers runtime).
  // Telling Next not to bundle it keeps the Workers build smaller and
  // avoids webpack trying to resolve its native bindings.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;

// Optionally initialize the Cloudflare context for `next dev`, so server
// components can call `getCloudflareContext()` and hit a local D1
// simulator. Off by default — `next dev` uses better-sqlite3 against
// `data/council-spend.db`. Set USE_CF_DEV=1 to opt in, in which case you
// also need `npm run d1:migrate:local` and a local D1 data load.
// For end-to-end Workers testing, prefer `npm run cf:preview` (wrangler
// dev against the bundled Worker).
if (process.env.USE_CF_DEV === "1") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");
  initOpenNextCloudflareForDev();
}
