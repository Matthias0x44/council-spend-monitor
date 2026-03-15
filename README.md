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

## Deploying to Vercel

The app uses [Turso](https://turso.tech) (cloud-hosted SQLite) for production.

### 1. Create a Turso database

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create council-spend
```

### 2. Push local data to Turso

```bash
./scripts/push-to-turso.sh council-spend
```

### 3. Get credentials

```bash
turso db show council-spend --url
turso db tokens create council-spend
```

### 4. Set environment variables on Vercel

Add these to your Vercel project settings:

- `TURSO_DATABASE_URL` — the URL from step 3
- `TURSO_AUTH_TOKEN` — the token from step 3

Then redeploy.

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
