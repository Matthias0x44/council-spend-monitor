import { NextResponse } from "next/server";
import { createClient } from "@libsql/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.TURSO_DATABASE_URL || "(not set)";
  const hasToken = !!process.env.TURSO_AUTH_TOKEN;

  const diagnostics: Record<string, unknown> = {
    turso_url_set: url !== "(not set)",
    turso_url_preview: url.slice(0, 50),
    has_auth_token: hasToken,
    node_env: process.env.NODE_ENV,
  };

  if (url === "(not set)") {
    diagnostics.error = "TURSO_DATABASE_URL is not set";
    return NextResponse.json(diagnostics, { status: 500 });
  }

  try {
    const client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const result = await client.execute("SELECT count(*) as cnt FROM councils");
    diagnostics.db_connected = true;
    diagnostics.council_count = result.rows[0]?.cnt;
  } catch (err: unknown) {
    diagnostics.db_connected = false;
    diagnostics.error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(diagnostics);
}
