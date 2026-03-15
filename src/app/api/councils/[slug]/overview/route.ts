import { NextRequest, NextResponse } from "next/server";
import { getCouncilBySlug, getOverview, getFinancialYears, getLatestFinancialYear } from "@/lib/queries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const council = await getCouncilBySlug(slug);
  if (!council) {
    return NextResponse.json({ error: "Council not found" }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const fyLabel = searchParams.get("fy");

  const allFYs = await getFinancialYears(council.id);
  let targetFY = fyLabel
    ? allFYs.find((fy) => fy.label === fyLabel)
    : await getLatestFinancialYear(council.id);

  const overview = await getOverview(council.id, targetFY?.id);

  return NextResponse.json({
    council: { id: council.id, name: council.name, slug: council.slug, region: council.region },
    financialYear: targetFY?.label ?? null,
    availableYears: allFYs.map((fy) => fy.label),
    ...overview,
  });
}
