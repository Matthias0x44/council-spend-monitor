import { csvLine } from "@/lib/csv";
import type { TransactionFilters } from "@/lib/queries";
import { validDate } from "@/lib/fiscal";
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

  if (fyLabel && !targetFY) return NextResponse.json({ error: "Financial year unavailable" }, { status: 404 });

  for (const key of ["page", "pageSize"] as const) {
    const value = sp.get(key);
    if (value !== null && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > (key === "pageSize" ? 500 : 100000))) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
  }
  for (const key of ["minAmount", "maxAmount"] as const) {
    const value = sp.get(key);
    if (value !== null && (!value.trim() || !Number.isFinite(Number(value)))) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
  }
  for (const key of ["startDate", "endDate"] as const) {
    const value = sp.get(key);
    if (value !== null && !validDate(value)) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
  }
  if (sp.has("sortBy") && !["amount", "date", "supplier", "directorate"].includes(sp.get("sortBy")!)) return NextResponse.json({ error: "Invalid sortBy" }, { status: 400 });
  if (sp.has("sortDir") && !["asc", "desc"].includes(sp.get("sortDir")!)) return NextResponse.json({ error: "Invalid sortDir" }, { status: 400 });
  if (sp.has("minAmount") && sp.has("maxAmount") && Number(sp.get("minAmount")) > Number(sp.get("maxAmount"))) return NextResponse.json({ error: "Invalid amount range" }, { status: 400 });
  if (sp.has("startDate") && sp.has("endDate") && sp.get("startDate")! > sp.get("endDate")!) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  const filters: TransactionFilters = {
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
  };
  if (sp.get("format") === "csv") {
    const encoder = new TextEncoder();
    let page = 1;
    let total: number | undefined;
    let done = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(csvLine(["Supplier", "Amount GBP", "Date", "Directorate", "Service", "Publisher category", "Service classification", "Classification evidence", "Classifier version", "Description", "Source URL"]))); },
      async pull(controller) {
        if (done || request.signal.aborted) { controller.close(); return; }
        try {
          const result = await getTransactions(council.id, { ...filters, page, pageSize: 500 }, total);
          total ??= result.total;
          controller.enqueue(encoder.encode(result.rows.map(r => csvLine([r.supplierName,r.amount,r.date || r.month,r.directorate,r.service,r.category,r.serviceClassification,r.classificationEvidence,r.classifierVersion,r.description,r.sourceUrl])).join("")));
          done = page >= result.totalPages;
          page++;
          if (done) controller.close();
        } catch (error) { controller.error(error); }
      },
      cancel() { done = true; },
    });
    return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="transactions-${council.slug}-${targetFY?.label || "all"}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const result = await getTransactions(council.id, filters);
  return NextResponse.json(result);
}
