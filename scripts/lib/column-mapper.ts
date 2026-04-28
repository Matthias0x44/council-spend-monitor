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
    "payee",
    "merchant name",
    "company name",
    "creditor name",
    "creditor",
    "vendor",
    "payment to",
    "paid to",
    "body name",
    "organisation name",
    "organisation",
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
    "spend",
    "expenditure",
    "payment value",
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
  return header.toLowerCase().trim().replace(/\s+/g, " ");
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

  // Pass 1: exact match against known variants (highest confidence)
  for (const [field, variants] of Object.entries(FIELD_VARIANTS)) {
    if (variants.includes(norm)) {
      return { field: field as CanonicalField, score: 1.0 };
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

  // Collect unmapped headers
  for (const header of headers) {
    if (!mapping[header]) unmapped.push(header);
  }

  const missingRequired = REQUIRED_FIELDS.filter((f) => !usedFields.has(f));
  const confidence = mappedCount > 0 ? totalScore / mappedCount : 0;

  return { mapping, unmapped, confidence, missingRequired };
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
