import { NextRequest, NextResponse } from "next/server";
import { getCouncilBySlug, getTransactions, getFinancialYears } from "@/lib/queries";

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
  const allFYs = await getFinancialYears(council.id);
  const fyLabel = sp.get("fy");
  const targetFY = fyLabel ? allFYs.find((fy) => fy.label === fyLabel) : undefined;

  const result = await getTransactions(council.id, {
    fyId: targetFY?.id,
    directorate: sp.get("directorate") || undefined,
    category: sp.get("category") || undefined,
    supplier: sp.get("supplier") || undefined,
    search: sp.get("search") || undefined,
    minAmount: sp.get("minAmount") ? Number(sp.get("minAmount")) : undefined,
    maxAmount: sp.get("maxAmount") ? Number(sp.get("maxAmount")) : undefined,
    startDate: sp.get("startDate") || undefined,
    endDate: sp.get("endDate") || undefined,
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : 50,
    sortBy: sp.get("sortBy") || "amount",
    sortDir: (sp.get("sortDir") as "asc" | "desc") || "desc",
  });

  return NextResponse.json(result);
}
