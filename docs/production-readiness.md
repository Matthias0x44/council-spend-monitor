# Production readiness evidence

As of 22 September 2026. The code is being hardened against the existing D1 database. **The national dataset is incomplete and the new Worker has not been deployed.**

## Scope and source receipts

- Retain five financial years including the current year: FY 2022–23 through FY 2026–27, excluding future transaction dates.
- Government authority-register snapshot: `data/english-authorities-source.csv`; derived identities: `data/england-registry.json`. There are 317 current authorities and 20 predecessors overlapping the retained period. Identity mappings distinguish North Yorkshire and Somerset from their predecessors.
- Production store: Cloudflare D1 `council-spend`. Files are downloaded individually, parsed in an isolated process with a deadline, and deleted after import. A national local database is not required.
- Original D1 audit: 11,006,976 transactions, 69 populated council entries and 776 registry entries. Some entries were duplicate aliases or outside the verified English universe.
- 742,262 invalid/out-of-window legacy rows were moved to `transaction_quarantine` inside D1, with original IDs and reasons retained. This includes misinterpreted accounting periods that produced years 2450–2454. The public ledger excludes quarantine. A further 1,700 contract-register records and 9,403 Nottingham business-rate register entries were quarantined as non-payment publications. The discovery filter and legacy cleanup now share the same publication-type exclusions.
- Each import records URL, content hash, semantic hash and outcome. Recovery bookmarks and detailed import/coverage receipts are in `data/reports/` and GitHub Actions artifacts; they are not committed as live production truth.

## Cloud execution

The branch passed GitHub application validation and a Nottingham D1 pilot (run 35780183220). The pilot checked five unchanged source files without adding duplicate rows, then completed the retention and coverage audit. A national run, 35780852687, is processing the 337 current/predecessor authorities in 23 serial groups; it is not evidence of completed national coverage. Imports write directly to D1 and retain small audit artifacts in GitHub. The old default-branch Turso schedule remains disabled until the replacement is merged.

The pre-run coverage receipt on 22 September showed 10,719,665 retained English payment rows, 67 authorities with payments and 15,657 authority-month gaps. This preceded the additional 9,403-row business-rate cleanup and subsequent national imports; refer to the latest run artifact for an updated snapshot.

## Repairs

The importer applies strict dates and amounts, preserves credits and small published payments, searches past spreadsheet preambles, handles multiple sheets, and separates text labels from codes. Source replacement is atomic, repeated imports are idempotent, and equivalent whole-file CSV/XLSX exports are identified by row-multiset hashes. A large row-count regression leaves the published source unchanged. Invalid files, missing columns, source rate limits and parse deadlines appear in the import report.

The dashboard distinguishes missing months from zero, marks coverage as partial, retains source links and original categories, validates API parameters, scopes budgets to their council, exports all matching rows with spreadsheet-formula protection, and disables unsupported annual comparisons. Mobile overflow was found and corrected at a 390px viewport. Browser checks covered council search, a missing-data council, a populated dashboard and an empty transaction search.

Production dependency audit: zero known vulnerabilities at the recorded audit time. Next.js and SheetJS were updated. The Next.js/OpenNext production Worker build passed. All 19 regression tests and both application/importer type checks pass. Lint has no errors and one pre-existing unused-variable warning in the legacy Turso helper. Automated regression coverage includes fiscal boundaries, invalid dates/amounts, refunds, repeated payment lines, idempotent imports, late headers, multiple sheets, equivalent formats, Coventry text/code selection, API validation, council budget isolation, supplier search, full CSV export, financial-year filter options, missing-vs-redacted suppliers, tax-register rejection, rate-limit delays and parser termination. CSV chunks reuse their initial total count instead of repeatedly counting the entire selection.

## Classifier evidence

`service-rules-3` emits service labels with the source field and text supporting the rule. It preserves the publisher's category separately. Supplier names never determine service. Mixed directorates, conflicting labels and vague descriptions cause abstention; old stored classifications are recomputed with current rules when returning transactions.

The committed developer-reviewed diagnostic fixture contains 80 source-label combinations from four councils. The current rules emit 25 labels agreeing with those reviewed meanings and abstain on 55. This is a regression diagnostic, **not an independent, representative estimate of national accuracy**. No accuracy percentage is claimed. Broad descriptions, council-specific abbreviations, misleading source fields and service overlaps remain risks. Additional independently reviewed, stratified examples should be added as councils are onboarded.

## Remaining release gates

1. Finish the national source attempts, repair discoverable broken links and reconcile the authority-month coverage report. A populated month alone cannot certify a complete set. Some councils expose only short rolling histories or block automated downloads; unavailable history must remain an explicit gap.
2. Resolve reviewed source-overlap cases. Whole-file equality is handled, but equivalent month subsets are also detected across annual/rolling files. Partly overlapping months still require source review; genuinely repeated payment lines cannot safely be dropped.
3. Improve the remaining large-council cold-page latency and check a deployed preview. A built Worker using a remote D1 binding returned successful health, dashboard, filter and council-list responses. After consolidating flag scans, reusing supplier rankings, narrowing filter lists and preventing the broad month index from displacing the financial-year key, observed Coventry full-response time fell from 10.8 to 5.1 seconds, Cambridgeshire from 59.5 to 14.5 seconds, and an empty Nottingham amount filter from 38.2 to 0.77 seconds. These are one-off local Worker/remote-binding timings during ingestion, not controlled production benchmarks; 14.5 seconds remains too slow. The national council endpoint took 6.6 seconds. Consider maintained summaries or cache-backed responses before release. `PRAGMA optimize` returned a D1 storage timeout although sampled statistics were subsequently present; it was not retried. The targeted amount-count comparison reduced database reads from 154,679 to 33,114 with the financial-year index.
4. Review the completed import audit before publishing claims of national completeness or classifier accuracy. The application must continue to show qualified coverage until evidence supports stronger claims.
5. Deploy the verified Worker and smoke-test live source links, filters, fiscal-year selection and CSV downloads. This document is not evidence that deployment occurred.

D1 imports stop at 8.5 GB to preserve operational headroom below the per-database limit. If national coverage reaches the guard, introduce council-based shards and routing before continuing; do not trim valid in-window payments to fit.

## Reproduce

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run cf:build
npm run d1:coverage
```

Relevant primary sources: [government register](https://github.com/digital-land/dluhc-datasets/blob/main/data/registers/local-authority.csv), [Transparency Code](https://www.gov.uk/government/publications/local-government-transparency-code-2015/local-government-transparency-code-2015), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). Source-specific availability is documented by [Leeds](https://www.leeds.gov.uk/performance-and-spending/our-financial-plans/spending-over-%C2%A3500) and [Birmingham's dataset](https://www.cityobservatory.birmingham.gov.uk/explore/dataset/payments-to-suppliers-over-gbp500/); discovery must use the current publisher endpoints rather than assume old links remain valid.
