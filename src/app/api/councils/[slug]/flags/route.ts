import { NextRequest, NextResponse } from "next/server";
import { getCouncilBySlug, getFlags, getFinancialYears, getLatestFinancialYear } from "@/lib/queries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const council = await getCouncilBySlug(slug);
  if (!council) {
    return NextResponse.json({ error: "Council not found" }, { status: 404 });
  }

  const fyLabel = request.nextUrl.searchParams.get("fy");
  const allFYs = await getFinancialYears(council.id);
  const targetFY = fyLabel
    ? allFYs.find((fy) => fy.label === fyLabel)
    : await getLatestFinancialYear(council.id);

  const flags = await getFlags(council.id, targetFY?.id);
  return NextResponse.json({ financialYear: targetFY?.label ?? null, flags });
}
