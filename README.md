# Council Spend Monitor

A public-finance dashboard for UK council spending data. Built with Next.js, Turso/SQLite, and Drizzle ORM.

## Features

- **Overview cards** — total spend, avg transaction, year-on-year change, supplier count
- **Transparency flags** — redacted supplier spend, missing category data, large payments
- **Spend breakdowns** — by service area, category, and supplier
- **Monthly trend** — line chart of spending over time
- **Transaction table** — searchable, filterable, sortable, with CSV export and hover tooltips
- **Financial year selector** — switch between years (2017–18 to 2025–26)

## Getting Started (Local)

### 1. Install dependencies

```bash
npm install
```

### 2. Seed the database

Downloads data from Kirklees Council's transparency page and ingests it into a local SQLite database:

```bash
npm run seed
```

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Locally, the app reads from `data/council-spend.db`.

## Deploying to Cloudflare

The app is being migrated from Vercel + Turso to Cloudflare Pages + D1.
Local dev still uses `better-sqlite3` against `data/council-spend.db`.

### 1. Provision Cloudflare resources

```bash
npx wrangler login
npx wrangler d1 create council-spend
```

Copy the `database_id` printed by the create command into `wrangler.toml`
(replace `REPLACE_WITH_D1_DATABASE_ID`).

### 2. Apply schema

```bash
npm run d1:migrate:remote
```

This runs `scripts/d1/schema.sql` against the remote D1 database.
`scripts/d1/schema.sql` is the canonical DDL — local `pipeline.ts` and
`seed-registry.ts` read from the same file.

### 3. Set credentials

Create an API token at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
with the `Account → D1 → Edit` permission. Find your account id in any
dashboard URL (`/accounts/<id>/...`) or via `wrangler whoami`.

Add to `.env` for local pushes:

```bash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
D1_DATABASE_ID=...
```

And to GitHub Actions repo secrets, with the same names.

### 4. Push local data to D1

```bash
npm run d1:push                # full replace
npm run d1:push -- --slug bristol   # scoped to one council
```

The scoped form deletes only that council's rows in D1 before re-inserting,
so you can re-scrape one council without affecting the others.

## Tech Stack

- **Next.js 16** (App Router, Server Components)
- **Turso / LibSQL** for serverless-compatible SQLite
- **Drizzle ORM** for type-safe queries
- **Recharts** for data visualisation
- **Tailwind CSS** for styling

## Data Sources

- Kirklees Council expenditure data (monthly XLSX/CSV files, >£500 transactions)
- Budget summary PDFs and statement of accounts (heuristic parsing)

## Scripts

| Command | Description |
|---|---|
| `npm run seed` | Full pipeline: scrape + ingest |
| `npm run scrape` | Download raw files only |
| `npm run ingest` | Parse spreadsheets into DB |
| `npm run ingest:budgets` | Parse budget PDFs into DB |
