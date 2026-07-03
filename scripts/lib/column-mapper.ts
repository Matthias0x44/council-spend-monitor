/**
 * Fuzzy column auto-detection for UK council spending CSVs.
 *
 * Maps arbitrary spreadsheet headers to canonical fields
 * using exact match, then substring match, then keyword scoring.
 */

export type CanonicalField =
  | "supplier"
  | "amount"
  | "date"
  | "service"
  | "directorate"
  | "category"
  | "description";

export type ColumnMapping = Record<string, CanonicalField>;

const FIELD_VARIANTS: Record<CanonicalField, string[]> = {
  supplier: [
    "vendor name",
    "supplier name",
    "supplier",
    "beneficiary",
    "beneficiary name",
    // Leeds CSVs through mid-2020 have a typo in the header.
    "benificiary",
    "benificiary name",
    "payee",
    "payee name",
    "merchant name",
    "company name",
    "creditor name",
    "creditor",
    "vendor",
    "payment to",
    "paid to",
    "mch.merchant name",
    "mch.merchant name - original",
  ],
  amount: [
    "amount excluding vat",
    "amount",
    "gross amount",
    "net amount",
    "total",
    "value",
    "payment amount",
    "amount paid",
    "amount (£)",
    "amount(£)",
    "amount £",
    "amount in £",
    "sum",
    "fin.net transaction amount",
    "transaction amount",
    "invoice amount",
    "total paid",
    "net value",
    "invoiced",
    "invoiced amount",
    "payment value",
    // Stockport's "All Spend" CSVs use a snake_case header. normalizeHeader
    // collapses underscores into spaces so we list it both ways for clarity.
    "net_amount",
  ],
  date: [
    "payment date",
    "date",
    "invoice date",
    "transaction date",
    "period",
    "date paid",
    "date of payment",
    "fin.transaction date",
    "posting date",
    "paid date",
  ],
  service: [
    "cost centre description",
    "cost centre name",
    "service area",
    "service",
    "service description",
    "cost centre",
    "department",
    "department name",
    "section",
    "unit",
    "acc.default accounting code 01 description",
    "service area description",
  ],
  directorate: [
    "directorate",
    "directorate name",
    "portfolio",
    "portfolio name",
    "division",
    "cabinet member",
    "cabinet member portfolio",
    "strategic director area",
  ],
  category: [
    "proclass description",
    "proclass category",
    "category",
    "expense type",
    "expense area",
    "subjective",
    "expenditure category",
    "spend classification",
    "expenditure type",
    "mch.mcc description",
    "account description",
    "spend type",
    "procurement category",
    "proclass level 1 description",
  ],
  description: [
    "purpose of spend",
    "description",
    "purpose",
    "transaction description",
    "narrative",
    "expense description",
    "summary",
    "fin.accounting code 02 description",
    "payment description",
    "details",
    "transaction narrative",
  ],
};

const KEYWORD_SCORES: Record<CanonicalField, string[]> = {
  supplier: ["vendor", "supplier", "payee", "beneficiary", "merchant", "creditor", "company"],
  amount: ["amount", "value", "total", "paid", "sum", "net", "gross"],
  date: ["date", "period", "posted"],
  service: ["service", "cost centre", "department", "section", "unit"],
  directorate: ["directorate", "portfolio", "division", "cabinet"],
  category: ["category", "classification", "proclass", "expense", "subjective", "expenditure"],
  description: ["description", "purpose", "narrative", "summary", "details"],
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, " ");
}

/**
 * Headers that should never be assigned to a canonical field, even if
 * they happen to substring-match a variant. These typically refer to
 * the *publishing* authority (per the UK Local Government Transparency
 * Code) or to transaction identifiers/VAT numbers — never to the supplier.
 */
const HEADER_BLOCKLIST: ReadonlySet<string> = new Set([
  // Publishing-authority identifiers (the council *itself*, not its suppliers).
  // Per the UK Local Government Transparency Code, "Body" / "Organisation" /
  // "Authority" describe the publishing council. Their value is the same on
  // every row, which collapses analytics if mistaken for the supplier column.
  "body",
  "body name",
  "body uri",
  "organisation",
  "organisation name",
  "organisation uri",
  "publisher",
  "publisher name",
  "publishing body",
  "publishing body name",
  "authority",
  "authority name",
  "local authority",
  "local authority name",
  "council",
  "council name",
  "council uri",
  "lea",
  "lea name",
  // Identifier/reference columns that can substring-match field variants.
  "transaction number",
  "transaction id",
  "transaction identifier",
  "transaction no",
  "transaction no.",
  "vat number",
  "vat registration number",
  "vat reg no",
  "supplier id",
  "vendor number",
  "vendor id",
  "supplier number",
]);

function isBlockedHeader(header: string): boolean {
  return HEADER_BLOCKLIST.has(normalizeHeader(header));
}

/**
 * Try to map a single header to a canonical field.
 * Returns the field and a confidence score (0-1).
 */
function scoreHeader(
  header: string
): { field: CanonicalField; score: number } | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;
  if (HEADER_BLOCKLIST.has(norm)) return null;

  // Pass 1: exact match against known variants (highest confidence).
  // Variants are listed most-specific-first, so when two different headers
  // exact-match the same field (e.g. Kirklees has both "Cost Centre" and
  // "Cost Centre Description", both valid `service` variants), the earlier
  // variant should win. A tiny index penalty encodes that preference without
  // dropping below the substring-match tier (0.8).
  for (const [field, variants] of Object.entries(FIELD_VARIANTS)) {
    const idx = variants.indexOf(norm);
    if (idx !== -1) {
      return { field: field as CanonicalField, score: 1.0 - idx * 0.001 };
    }
  }

  // Pass 2: substring match (a variant is contained in the header, or vice versa)
  for (const [field, variants] of Object.entries(FIELD_VARIANTS)) {
    for (const variant of variants) {
      if (norm.includes(variant) || variant.includes(norm)) {
        return { field: field as CanonicalField, score: 0.8 };
      }
    }
  }

  // Pass 3: keyword scoring (split header into words, count keyword hits)
  let bestField: CanonicalField | null = null;
  let bestScore = 0;
  const words = norm.split(/[\s_\-.]+/);

  for (const [field, keywords] of Object.entries(KEYWORD_SCORES)) {
    let hits = 0;
    for (const word of words) {
      if (keywords.some((kw) => word.includes(kw) || kw.includes(word))) {
        hits++;
      }
    }
    if (hits > 0) {
      const score = Math.min(hits / words.length, 0.6);
      if (score > bestScore) {
        bestScore = score;
        bestField = field as CanonicalField;
      }
    }
  }

  if (bestField && bestScore >= 0.3) {
    return { field: bestField, score: bestScore };
  }

  return null;
}

export interface MappingResult {
  mapping: ColumnMapping;
  unmapped: string[];
  confidence: number; // average confidence across mapped fields
  missingRequired: CanonicalField[];
}

const REQUIRED_FIELDS: CanonicalField[] = ["supplier", "amount"];

/**
 * Auto-detect column mapping from a list of spreadsheet headers.
 *
 * If a `profileOverride` is provided (from the council's scrape_profile),
 * those mappings take priority over auto-detection.
 */
export function detectColumns(
  headers: string[],
  profileOverride?: Record<string, string>
): MappingResult {
  const mapping: ColumnMapping = {};
  const unmapped: string[] = [];
  const usedFields = new Set<CanonicalField>();
  let totalScore = 0;
  let mappedCount = 0;

  // Apply profile overrides first
  if (profileOverride) {
    for (const [rawHeader, canonicalField] of Object.entries(profileOverride)) {
      const norm = normalizeHeader(rawHeader);
      const matchingHeader = headers.find(
        (h) => normalizeHeader(h) === norm
      );
      if (matchingHeader && !usedFields.has(canonicalField as CanonicalField)) {
        mapping[matchingHeader] = canonicalField as CanonicalField;
        usedFields.add(canonicalField as CanonicalField);
        totalScore += 1.0;
        mappedCount++;
      }
    }
  }

  // Score all remaining headers
  const candidates: { header: string; field: CanonicalField; score: number }[] = [];
  for (const header of headers) {
    if (mapping[header]) continue;
    const result = scoreHeader(header);
    if (result) {
      candidates.push({ header, ...result });
    }
  }

  // Sort by score descending and greedily assign (each field can only be assigned once)
  candidates.sort((a, b) => b.score - a.score);
  for (const { header, field, score } of candidates) {
    if (usedFields.has(field)) continue;
    if (mapping[header]) continue;
    mapping[header] = field;
    usedFields.add(field);
    totalScore += score;
    mappedCount++;
  }

  // Fallback: UK Local Government Transparency Code uses a bare "Name"
  // column for the supplier/beneficiary. We don't include "name" in the
  // variants list (it would substring-match too aggressively), so handle
  // it here only if no other supplier candidate has been chosen.
  if (!usedFields.has("supplier")) {
    const nameHeader = headers.find(
      (h) => normalizeHeader(h) === "name" && !mapping[h] && !isBlockedHeader(h)
    );
    if (nameHeader) {
      mapping[nameHeader] = "supplier";
      usedFields.add("supplier");
      totalScore += 0.7;
      mappedCount++;
    }
  }

  // Collect unmapped headers
  for (const header of headers) {
    if (!mapping[header]) unmapped.push(header);
  }

  const missingRequired = REQUIRED_FIELDS.filter((f) => !usedFields.has(f));
  const confidence = mappedCount > 0 ? totalScore / mappedCount : 0;

  return { mapping, unmapped, confidence, missingRequired };
}

/**
 * Sanity-check the supplier column by inspecting actual values. If the
 * column is dominated by URLs/URIs (a tell-tale sign we picked a Linked
 * Data publisher identifier instead of the real payee), try to swap to
 * a different available column. Returns the (possibly updated) mapping
 * along with a warning message if a swap was made.
 */
export function validateSupplierColumn(
  mapping: ColumnMapping,
  rows: Record<string, unknown>[],
  headers: string[]
): { mapping: ColumnMapping; warning?: string } {
  const supplierHeader = Object.keys(mapping).find(
    (h) => mapping[h] === "supplier"
  );
  if (!supplierHeader) return { mapping };

  const sample = rows.slice(0, 200);
  if (sample.length === 0) return { mapping };

  let urlLike = 0;
  let nonEmpty = 0;
  let totalLen = 0;
  const valueCounts = new Map<string, number>();
  for (const row of sample) {
    const v = row[supplierHeader];
    if (v == null || v === "") continue;
    nonEmpty++;
    const trimmed = String(v).trim();
    totalLen += trimmed.length;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
      urlLike++;
    }
    valueCounts.set(trimmed, (valueCounts.get(trimmed) || 0) + 1);
  }
  if (nonEmpty === 0) return { mapping };

  // Failure patterns we want to catch:
  //   1. >=50% of values are URIs (Bristol's "Body Name" → OS Linked Data URI)
  //   2. A single value dominates >=80% of rows (Rochdale's "ORGANISATION
  //      NAME" → council's own name, repeated on every line)
  //   3. The column is a low-cardinality flag/code field (Leeds' "Capital Or
  //      Revenue" → "R" / "C"). Real supplier names average tens of chars
  //      and produce hundreds of unique values per file.
  const looksLikeUris = urlLike / nonEmpty >= 0.5;
  let topValue: { value: string; count: number } | null = null;
  for (const [value, count] of valueCounts) {
    if (!topValue || count > topValue.count) topValue = { value, count };
  }
  const dominationRatio = topValue ? topValue.count / nonEmpty : 0;
  const looksLikePublisher = nonEmpty >= 20 && dominationRatio >= 0.8;
  const avgLen = totalLen / nonEmpty;
  const distinctRatio = valueCounts.size / nonEmpty;
  const looksLikeFlagColumn =
    nonEmpty >= 20 &&
    avgLen <= 3 &&
    valueCounts.size <= 5 &&
    distinctRatio < 0.1;

  if (!looksLikeUris && !looksLikePublisher && !looksLikeFlagColumn) {
    return { mapping };
  }

  // Pick the best replacement column from the headers that haven't been
  // claimed yet. Preference order: an exact "Name" column, then "Supplier
  // Name" / "Vendor Name" / "Payee Name" / etc., then anything containing
  // "supplier" / "vendor" / "payee" as a whole-word match.
  const claimed = new Set(Object.keys(mapping));
  const candidates = headers.filter(
    (h) => h !== supplierHeader && !claimed.has(h) && !isBlockedHeader(h)
  );

  const supplierKeywords = [
    /^supplier name$/,
    /^vendor name$/,
    /^payee name$/,
    /^beneficiary name$/,
    /^merchant name$/,
    /^name$/,
    /\bsupplier\b/,
    /\bvendor\b/,
    /\bpayee\b/,
    /\bbeneficiary\b/,
    /\bmerchant\b/,
  ];
  let replacement: string | null = null;
  for (const pattern of supplierKeywords) {
    replacement = candidates.find((h) => pattern.test(normalizeHeader(h))) || null;
    if (replacement) break;
  }

  const reason = looksLikeUris
    ? `URIs (${urlLike}/${nonEmpty})`
    : looksLikeFlagColumn
    ? `flag column (${valueCounts.size} distinct values, avg ` +
      `${avgLen.toFixed(1)} chars across ${nonEmpty} rows)`
    : `single value "${topValue!.value.slice(0, 40)}" dominates ` +
      `${topValue!.count}/${nonEmpty} rows`;

  if (replacement) {
    const newMapping = { ...mapping };
    delete newMapping[supplierHeader];
    newMapping[replacement] = "supplier";
    return {
      mapping: newMapping,
      warning: `Supplier column "${supplierHeader}" looked wrong (${reason}); remapped to "${replacement}"`,
    };
  }

  return {
    mapping,
    warning: `Supplier column "${supplierHeader}" looked wrong (${reason}) and no replacement column was found`,
  };
}

function parseNumericCell(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[£$€,\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  if (!cleaned || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sanity-check the amount column by sampling rows. If <50% of values
 * parse as numbers, the mapper probably picked a description-style
 * column whose header happened to substring-match an amount variant
 * (e.g. Stockport's "Summary of Purpose of Expenditure"). Try to swap
 * to a column whose values *are* numeric.
 */
export function validateAmountColumn(
  mapping: ColumnMapping,
  rows: Record<string, unknown>[],
  headers: string[]
): { mapping: ColumnMapping; warning?: string } {
  const amountHeader = Object.keys(mapping).find(
    (h) => mapping[h] === "amount"
  );
  if (!amountHeader) return { mapping };

  const sample = rows.slice(0, 200);
  if (sample.length === 0) return { mapping };

  let numeric = 0;
  let nonEmpty = 0;
  for (const row of sample) {
    const v = row[amountHeader];
    if (v == null || v === "") continue;
    nonEmpty++;
    if (parseNumericCell(v) !== null) numeric++;
  }
  if (nonEmpty === 0) return { mapping };
  if (numeric / nonEmpty >= 0.5) return { mapping };

  // Pick the column with the most numeric values among unclaimed headers.
  const claimed = new Set(Object.keys(mapping));
  let best: { header: string; score: number } | null = null;
  for (const h of headers) {
    if (h === amountHeader) continue;
    if (claimed.has(h)) continue;
    if (isBlockedHeader(h)) continue;
    let hits = 0;
    let total = 0;
    for (const row of sample) {
      const v = row[h];
      if (v == null || v === "") continue;
      total++;
      if (parseNumericCell(v) !== null) hits++;
    }
    if (total < 10) continue;
    const score = hits / total;
    if (score < 0.8) continue;
    if (!best || score > best.score) best = { header: h, score };
  }

  if (best) {
    const newMapping = { ...mapping };
    delete newMapping[amountHeader];
    newMapping[best.header] = "amount";
    return {
      mapping: newMapping,
      warning:
        `Amount column "${amountHeader}" was only ${numeric}/${nonEmpty} ` +
        `numeric; remapped to "${best.header}" (${Math.round(best.score * 100)}% numeric)`,
    };
  }

  return {
    mapping,
    warning:
      `Amount column "${amountHeader}" was only ${numeric}/${nonEmpty} ` +
      `numeric; no better column found`,
  };
}

/** A value that is only digits (plus separators) — a code, not a label. */
function isNumericCode(v: unknown): boolean {
  if (v == null || v === "") return false;
  if (typeof v === "number") return true;
  return /^[0-9][0-9\s\-/.]*$/.test(String(v).trim());
}

/**
 * Sanity-check the chosen service column by inspecting values. Councils
 * often publish a numeric cost-centre *code* ("Cost Centre" = 660789)
 * alongside its human label ("Cost Centre Description" = "Disabled
 * Facilities"). Both headers exact-match the `service` variants, and if the
 * code column wins we end up showing meaningless numbers. If the mapped
 * service column is dominated by numeric codes, swap to an unclaimed
 * descriptive column; if none exists, drop the mapping (blank beats a code).
 */
export function validateServiceColumn(
  mapping: ColumnMapping,
  rows: Record<string, unknown>[],
  headers: string[]
): { mapping: ColumnMapping; warning?: string } {
  const serviceHeader = Object.keys(mapping).find(
    (h) => mapping[h] === "service"
  );
  if (!serviceHeader) return { mapping };

  const sample = rows.slice(0, 200);
  if (sample.length === 0) return { mapping };

  let numericCode = 0;
  let nonEmpty = 0;
  for (const row of sample) {
    const v = row[serviceHeader];
    if (v == null || v === "") continue;
    nonEmpty++;
    if (isNumericCode(v)) numericCode++;
  }
  if (nonEmpty === 0) return { mapping };
  if (numericCode / nonEmpty < 0.6) return { mapping };

  const claimed = new Set(Object.keys(mapping));
  const candidates = headers.filter(
    (h) => h !== serviceHeader && !claimed.has(h) && !isBlockedHeader(h)
  );

  // Prefer an explicit descriptive service label, in specificity order.
  const preferred = [
    "cost centre description",
    "cost centre name",
    "service area description",
    "service description",
    "service area",
    "service",
    "department name",
    "department",
  ];
  let replacement: string | null = null;
  for (const p of preferred) {
    replacement = candidates.find((h) => normalizeHeader(h) === p) || null;
    if (replacement) break;
  }

  // Otherwise, any unclaimed service-ish header whose values are mostly text.
  if (!replacement) {
    for (const h of candidates) {
      if (!/(description|service|area|purpose|cost centre|department)/.test(normalizeHeader(h))) {
        continue;
      }
      let text = 0;
      let total = 0;
      for (const row of sample) {
        const v = row[h];
        if (v == null || v === "") continue;
        total++;
        if (!isNumericCode(v)) text++;
      }
      if (total >= 10 && text / total >= 0.7) {
        replacement = h;
        break;
      }
    }
  }

  const newMapping = { ...mapping };
  delete newMapping[serviceHeader];
  if (replacement) {
    newMapping[replacement] = "service";
    return {
      mapping: newMapping,
      warning:
        `Service column "${serviceHeader}" was mostly numeric codes ` +
        `(${numericCode}/${nonEmpty}); remapped to "${replacement}"`,
    };
  }
  return {
    mapping: newMapping,
    warning:
      `Service column "${serviceHeader}" was mostly numeric codes ` +
      `(${numericCode}/${nonEmpty}) with no descriptive replacement; left blank`,
  };
}

/**
 * Apply a column mapping to a raw spreadsheet row,
 * returning a record keyed by canonical field names.
 */
export function applyMapping(
  row: Record<string, unknown>,
  mapping: ColumnMapping
): Record<CanonicalField | string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [rawKey, canonicalField] of Object.entries(mapping)) {
    if (row[rawKey] != null && row[rawKey] !== "" && !result[canonicalField]) {
      result[canonicalField] = row[rawKey];
    }
  }
  return result;
}
