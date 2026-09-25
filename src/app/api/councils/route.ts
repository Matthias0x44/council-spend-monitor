import { fiscalWindow } from "@/lib/fiscal";
import { getCouncilDirectory } from "@/lib/queries";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { councils, transactions } from "@/db/schema";
import { eq, sql, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("summary") === "1") {
    return NextResponse.json(await getCouncilDirectory());
  }
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
    .leftJoin(transactions, and(eq(transactions.councilId, councils.id), sql`${transactions.month} >= ${fiscalWindow().start.slice(0,7)} AND ${transactions.month} <= ${fiscalWindow().through.slice(0,7)} AND substr(${transactions.month},6,2) BETWEEN '01' AND '12'`))
    .where(sql`EXISTS (SELECT 1 FROM english_authorities WHERE council_id=${councils.id})`)
    .groupBy(councils.id)
    .orderBy(councils.name)
    .all();

  return NextResponse.json(rows);
}
