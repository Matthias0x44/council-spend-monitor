import { NextRequest, NextResponse } from "next/server";
import { getCouncilBySlug, getTopSuppliers, getFinancialYears } from "@/lib/queries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const council = await getCouncilBySlug(slug);
  if (!council) {
    return NextResponse.json({ error: "Council not found" }, { status: 404 });
  }

  const sp = request.nextUrl.searchParams;
  const fyLabel = sp.get("fy");
  const limit = sp.get("limit") ? Number(sp.get("limit")) : 20;
  const allFYs = await getFinancialYears(council.id);
  const targetFY = fyLabel ? allFYs.find((fy) => fy.label === fyLabel) : undefined;

  const data = await getTopSuppliers(council.id, targetFY?.id, limit);
  return NextResponse.json(data);
}
