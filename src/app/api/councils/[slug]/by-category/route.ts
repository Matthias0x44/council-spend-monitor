import { NextRequest, NextResponse } from "next/server";
import { getCouncilBySlug, getSpendByCategory, getFinancialYears } from "@/lib/queries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const council = getCouncilBySlug(slug);
  if (!council) {
    return NextResponse.json({ error: "Council not found" }, { status: 404 });
  }

  const fyLabel = request.nextUrl.searchParams.get("fy");
  const allFYs = getFinancialYears(council.id);
  const targetFY = fyLabel ? allFYs.find((fy) => fy.label === fyLabel) : undefined;

  const data = getSpendByCategory(council.id, targetFY?.id);
  return NextResponse.json(data);
}
