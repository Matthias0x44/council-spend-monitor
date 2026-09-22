# Council Spend Monitor

An interactive dashboard of **published payments by English local authorities**, built with Next.js 15, React 19, Drizzle and Cloudflare Workers/OpenNext. Production data lives in Cloudflare D1 `council-spend`.

The retained window is **five UK financial years including the current year**: 1 April 2022–31 March 2027 as of September 2026, with future-dated transactions excluded. The window rolls forward each April. The verified authority register includes current councils and predecessors operating during that window; successors remain separate.

## Data meaning and limitations

These are published payments, not audited total council expenditure. Publication thresholds, redactions, missing files, reversals and council reorganisations affect comparisons. A month with no imported payments is **unknown**, not zero. Even twelve populated months do not establish completeness. Annual growth comparisons are suppressed until completeness can be verified.

Original council categories are preserved. Service classification is a separate, versioned, explainable rule result with evidence. Ambiguous entries remain `Unclassified`; supplier names are not used to guess service. The diagnostic fixtures check known source labels, but **do not establish national accuracy**. A stratified, independently reviewed sample is still needed before publishing an accuracy percentage.

## Development and validation

Requires Node.js 22 or later.

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm run cf:build
```

For a small local development dataset:

```sh
npm run registry:england
npm run pipeline -- --slug kirklees
npm run dev
```

Local development uses `data/council-spend.db`. It is optional staging for development, not the source of production truth. Do not build a national SQLite copy to refresh D1.

## Direct D1 imports

Configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (D1 Edit) in `.env`, or as environment variables/GitHub Actions secrets. `D1_DATABASE_ID` can override the database ID in the project configuration. Never commit credentials.

For the existing production database, additive migrations and the English authority mapping are managed by `scripts/d1-migrate.mjs`. Read its prerequisite audit report before running it. The canonical DDL is `scripts/d1/schema.sql`; `CREATE TABLE IF NOT EXISTS` alone does not migrate existing columns.

```sh
npm run pipeline:d1                  # all registered English authorities
npm run pipeline:d1 -- --slug leeds  # one authority
npm run d1:coverage
```

The importer downloads one source at a time into temporary storage, parses it in memory, and stages rows remotely. It validates row counts before atomically replacing that source URL. Failed downloads or rejected files leave the previous published source intact. Content hashes make repeat imports idempotent; whole-file and per-month multiset hashes detect equivalent CSV/XLSX exports and annual/monthly copies without dropping repeated payment lines. Partly overlapping months still require source review. Parsing runs in a separate process with a one-minute deadline, and rate-limited hosts are deferred.

Imports write source-level outcomes to `data/reports/d1-backfill.json`. `d1-coverage.json` lists every expected authority-month and its observed row count. Missing sources and failed files are explicit gaps. A successful import is not a claim of complete publication. The importer exits nonzero if any source fails.

The scheduled GitHub Actions workflow writes directly to D1 and uploads reports, not a local database. Runs are split into bounded serial groups so an earlier failed group does not prevent later councils from running. D1 has a per-database storage limit; the importer stops at 8.5 GB to leave operational headroom. Further national growth may require sharding; never silently discard valid payments to meet that limit.

## Retention and recovery

`scripts/d1-quarantine.mjs` previews invalid/out-of-window rows; `--apply` moves them to a recovery table inside D1 before removing them from the public ledger. Recovery bookmarks are captured before mutation. D1 Time Travel has a finite recovery window; preserve receipts and use the quarantine for row-level recovery. Quarantine is excluded from public totals.

The legacy `d1:push` replacement path is guarded by `--replace` and is not used by the scheduled workflow. Do not replace D1 with an incomplete local database.

## Worker release

`wrangler.jsonc` binds the Worker to the existing D1 database. Validate the migration, API behaviour and data-quality report first, then build and deploy:

```sh
npm run cf:deploy
```

This builds the OpenNext Worker bundle before deployment. `npm run build` alone is a Next.js validation build, not the Cloudflare artifact. `cf:preview` uses a local D1 simulator; it does not automatically contain production data.

## Sources

- [Government local-authority register](https://github.com/digital-land/dluhc-datasets/blob/main/data/registers/local-authority.csv): snapshot and derived retained-window register in `data/`.
- [Local Government Transparency Code 2015](https://www.gov.uk/government/publications/local-government-transparency-code-2015/local-government-transparency-code-2015): publication context.
- `data/source-adapters.json`: council publication pages and data.gov.uk package IDs. Individual transaction records retain the source URL.
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

See `docs/production-readiness.md` for validation evidence and remaining release gates.
