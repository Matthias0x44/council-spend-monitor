import { NextResponse } from "next/server";
import { db } from "@/db";
import { councils, transactions } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select({
      id: councils.id,
      name: councils.name,
      slug: councils.slug,
      region: councils.region,
      scrapeStatus: councils.scrapeStatus,
      lastScrapedAt: councils.lastScrapedAt,
      transactionCount: sql<number>`(
        SELECT COUNT(*) FROM transactions WHERE transactions.council_id = ${councils.id}
      )`,
    })
    .from(councils)
    .orderBy(councils.name)
    .all();

  return NextResponse.json(rows);
}
