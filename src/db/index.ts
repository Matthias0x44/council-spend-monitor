import * as schema from "./schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
 * Runtime-aware Drizzle instance.
 *
 * The same `@/db` import works in three contexts:
 *
 *   - `next dev` and `next build` (Node):   better-sqlite3 against
 *     `data/council-spend.db` (or `LOCAL_DB_PATH` env override).
 *   - Cloudflare Workers (production):       drizzle-orm/d1 against the
 *     `DB` binding declared in wrangler.jsonc.
 *   - Local Workers preview (`opennextjs-cloudflare preview`):
 *     drizzle-orm/d1 against the local D1 simulator (also reached
 *     through `getCloudflareContext`).
 *
 * Callers should `const db = await getDb();` once per request.
 *
 * We type the return as the (async) D1 database for both branches.
 * better-sqlite3 is structurally compatible — every method we call
 * (`.select()`, `.from()`, `.where()`, `.get()`, `.all()`) exists on
 * both drivers. The only runtime difference is that better-sqlite3's
 * `.get()` / `.all()` return values directly while D1's return
 * Promises; awaiting either is safe in JavaScript. Keeping a single
 * concrete type preserves Drizzle's SELECT projection inference at
 * call sites (a union would collapse to the unprojected row type).
 */

export type Db = DrizzleD1Database<typeof schema>;

let cachedNodeDb: Db | null = null;

async function getCloudflareDb(): Promise<Db | null> {
  // getCloudflareContext throws outside Workers (e.g. during
  // `next build`), so we treat any error as "not in Cloudflare".
  try {
    const mod = await import("@opennextjs/cloudflare");
    const ctx = mod.getCloudflareContext();
    const d1 = (ctx?.env as { DB?: D1Database } | undefined)?.DB;
    if (!d1) return null;
    const { drizzle } = await import("drizzle-orm/d1");
    return drizzle(d1, { schema });
  } catch {
    return null;
  }
}

async function getNodeDb(): Promise<Db> {
  if (cachedNodeDb) return cachedNodeDb;
  const dbPath = process.env.LOCAL_DB_PATH || "./data/council-spend.db";
  const { existsSync } = await import("node:fs");
  if (!existsSync(dbPath)) {
    throw new Error(
      `Local database not found at ${dbPath}. ` +
        "For local dev run `npm run seed` or `npm run pipeline`. " +
        "On Cloudflare, deploy with `npm run cf:deploy` so the Worker uses the D1 binding at runtime — " +
        "do not use plain `npm run build` as the deploy build command."
    );
  }
  // better-sqlite3 is listed in next.config.ts `serverExternalPackages`
  // so Next/Turbopack keeps it as a runtime `require()` rather than
  // bundling its native bindings. This codepath only runs under plain
  // Node (next dev / next build) — never inside Cloudflare Workers.
  const mod = await import("better-sqlite3");
  const Database = (mod as unknown as { default: typeof import("better-sqlite3") }).default
    ?? (mod as unknown as typeof import("better-sqlite3"));
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(dbPath, { readonly: true });
  cachedNodeDb = drizzle(sqlite, { schema }) as unknown as Db;
  return cachedNodeDb;
}

export async function getDb(): Promise<Db> {
  const cf = await getCloudflareDb();
  if (cf) return cf;
  return getNodeDb();
}
