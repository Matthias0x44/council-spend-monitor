import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { councils } from "@/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const diagnostics: Record<string, unknown> = {
    node_env: process.env.NODE_ENV,
  };

  try {
    const db = await getDb();
    const row = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(councils)
      .get();
    diagnostics.db_connected = true;
    diagnostics.council_count = row?.cnt ?? 0;
  } catch (err: unknown) {
    diagnostics.db_connected = false;
    diagnostics.error = err instanceof Error ? err.message : String(err);
    return NextResponse.json(diagnostics, { status: 500 });
  }

  return NextResponse.json(diagnostics);
}
