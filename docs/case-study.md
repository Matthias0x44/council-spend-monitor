# Council Spend Monitor: data-quality case study

## The problem

English councils publish payment files for transparency, but their formats, thresholds, date conventions and archive policies differ. A single chart can hide those differences. This project explored how to make payments searchable while keeping the publisher's evidence and gaps visible.

The design aim was a national dashboard covering five UK financial years including the current year. The verified authority register contained 337 current or predecessor authorities during the September 2026 window. A full national dataset was **not** achieved. Operating a large live import became too expensive, so the hosted service was retired and the repository now carries a small offline demo.

## How records moved through the prototype

1. The authority register supplied a canonical identity and operating dates. A mapping resolved 48 official slugs that differed from existing database aliases. Unknown authorities failed visibly rather than being omitted.
2. Source adapters located council publications. The importer selected files in the retained window, downloaded one at a time and parsed CSV/XLS/XLSX in a bounded child process. It searched past worksheet preambles and preserved fields that were blank in the first row but populated later.
3. Dates, amounts and source mappings were validated. Credits remained negative, future dates were excluded, and a large replacement row-count regression blocked an unsafe source swap.
4. Each accepted file carried its URL and hashes. Whole-file and month fingerprints identified equivalent exports without deleting repeated payment lines that could be legitimate.
5. The dashboard surfaced original categories beside suggested service labels. Missing months were unknown; populated months still were not certified complete.

The production prototype used Next.js/OpenNext on Cloudflare Workers with D1. The public GitHub demo now seeds a local SQLite database from 272 selected, source-linked rows and makes no cloud requests.

## Classification and verification

The `service-rules-3` classifier uses service, directorate, category and description text in a conservative order. It never infers a service from a supplier name. Each emitted label carries a rule and evidence; mixed or vague evidence abstains.

Two developer-reviewed diagnostic fixtures contain 94 real source-label combinations from ten council pilots. Current rules emit 32 reviewed labels that agree with the fixture interpretation and abstain on 62; there are no observed disagreements in that diagnostic set. These labels were selected during development and are **not an independent or representative accuracy study**. The remaining risk includes council-specific shorthand, misleading account fields and functional services spanning several budget headings. National accuracy was never established.

The validation suite checks fiscal boundaries, malformed dates and amounts, refunds, repeated rows, idempotent imports, multiple worksheets, parser deadlines, source exclusions, API filters, council isolation and CSV escaping. A local Worker preview against remote D1 found that large council pages could still take several seconds, so performance also remained a release gate.

## What stopped the live rollout

The national import had not reconciled all authority-month gaps, source overlaps or inaccessible publisher archives. Cloudflare D1 reached about 8.5 GB, and the user received a $215 bill. D1 charges for rows read and written and for storage beyond the included allowance; the bill was not itemized in this repository, so its exact cause should not be inferred from the database size alone. See [Cloudflare's D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

On 25 September 2026, the import workflow was removed, repository cloud credentials were deleted, and the Worker and project D1 database were deleted. The remaining GitHub project is a reproducible portfolio demo. A future live deployment would need a new operating model and a separate, measured data acquisition plan.

## What the demo proves

The offline fixture covers nine councils and all five fiscal-year labels, but only selected rows. It proves the interface, data model, provenance links and classifier behavior can be inspected locally. Its totals, rankings and coverage counts are **sample-only** and cannot support conclusions about council spending or national data completeness.
