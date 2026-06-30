import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { councils, transactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const rows = await db
    .select({
      id: councils.id,
      name: councils.name,
      slug: councils.slug,
      region: councils.region,
      scrapeStatus: councils.scrapeStatus,
      lastScrapedAt: councils.lastScrapedAt,
      transactionCount: sql<number>`COALESCE(COUNT(${transactions.id}), 0)`,
    })
    .from(councils)
    .leftJoin(transactions, eq(transactions.councilId, councils.id))
    .groupBy(councils.id)
    .orderBy(councils.name)
    .all();

  return NextResponse.json(rows);
}
