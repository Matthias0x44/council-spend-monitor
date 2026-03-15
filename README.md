# Council Spend Monitor

A public-finance dashboard for UK council spending data. Built with Next.js, SQLite, and Drizzle ORM.

## Features

- **Overview cards** — recorded spend, transaction counts, variance
- **Spend breakdowns** — by service area, category, and supplier
- **Monthly trend** — line chart of spending over time
- **Spending flags** — supplier concentration, rising categories, large one-off payments
- **Transaction table** — searchable, filterable, sortable, with CSV export
- **Financial year selector** — switch between years

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Seed the database

Downloads data from Kirklees Council's transparency page and ingests it into a local SQLite database:

```bash
npm run seed
```

This runs three steps: scrape → ingest expenditure → ingest budgets.

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

- **Next.js 16** (App Router, Server Components)
- **SQLite** via better-sqlite3
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
