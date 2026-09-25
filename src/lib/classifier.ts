/** Service classification is separate from the publisher's expenditure category.
 * These are explainable rules, not calibrated probabilities. Ambiguity abstains.
 * Supplier names are deliberately excluded: suppliers serve multiple services.
 */
export const CLASSIFIER_VERSION = "service-rules-3";
const rules: [string, RegExp][] = [
  ["Adult social care", /\b(adult social care|adult care|adult safeguarding)\b/i],
  ["Children's social care", /\b(children'?s social care|childrens social care|children in care|looked after children|foster care|fostering|child protection|children'?s safeguarding|adoption services|adoption allowances|fostering allowances|residential children)\b/i],
  ["Education", /\b(education|schools?|early years|special educational needs|home to school|nursery payments|educational placements)\b/i],
  ["Public health", /\b(public health|sexual health|smoking cessation|substance misuse|drug and alcohol treatment)\b/i],
  ["Highways and transport", /\b(highways?|road maintenance|street lighting|traffic management|public transport|transport planning)\b/i],
  ["Housing", /\b(housing|homelessness|temporary accommodation|housing benefit)\b/i],
  ["Environmental services", /\b(waste collection|waste disposal|refuse collection|recycling|street cleansing|environmental health|cemeteries|crematoria)\b/i],
  ["Cultural and leisure services", /\b(libraries|library services|leisure centres?|sports centres?|parks and open spaces|museums?|arts and culture)\b/i],
  ["Planning and development", /\b(development control|planning applications|building control|economic development|regeneration|town planning)\b/i],
  ["Central services", /\b(corporate finance|human resources|democratic services|electoral services|council tax collection|internal audit|legal services|corporate ICT)\b/i],
];
export interface Classification {
  label: string;
  method: "rule" | "unresolved";
  evidence: string;
  version: string;
}
export function classifyService(input: { service?: string | null; directorate?: string | null; description?: string | null; category?: string | null }): Classification {
  // Prefer the most specific service field; broader directorates can span services.
  for (const field of ["service", "directorate", "category", "description"] as const) {
    const value = input[field]?.trim() || "";
    if (/\b(not|excluding|except)\b/i.test(value)) continue;
    if (/child.*(?:education|educational)|(?:education|educational).*child/i.test(value)) continue;
    if (/adult.*housing|housing.*adult/i.test(value)) continue;
    const matches = rules.filter(([, pattern]) => pattern.test(value));
    if (matches.length > 1) return { label: "Unclassified", method: "unresolved", evidence: `Conflicting service evidence in ${field}`, version: CLASSIFIER_VERSION };
    if (matches.length === 1) return { label: matches[0][0], method: "rule", evidence: `${field}: ${value}`, version: CLASSIFIER_VERSION };
  }
  return { label: "Unclassified", method: "unresolved", evidence: "No specific service evidence", version: CLASSIFIER_VERSION };
}
