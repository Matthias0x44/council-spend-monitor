#!/bin/bash
# Push local SQLite database to Turso
# Usage: ./scripts/push-to-turso.sh <turso-db-name>
#
# Prerequisites:
#   1. Install Turso CLI: curl -sSfL https://get.tur.so/install.sh | bash
#   2. Log in: turso auth login
#   3. Create a database: turso db create council-spend
#   4. Run this script: ./scripts/push-to-turso.sh council-spend
#
# After pushing, get your credentials for Vercel:
#   turso db show council-spend --url
#   turso db tokens create council-spend

set -euo pipefail

DB_NAME="${1:?Usage: $0 <turso-db-name>}"
LOCAL_DB="data/council-spend.db"

if [ ! -f "$LOCAL_DB" ]; then
  echo "Error: $LOCAL_DB not found. Run 'npm run seed' first."
  exit 1
fi

echo "Dumping local SQLite database..."
sqlite3 "$LOCAL_DB" .dump > data/dump.sql

echo "Pushing to Turso database: $DB_NAME"
turso db shell "$DB_NAME" < data/dump.sql

rm data/dump.sql

echo ""
echo "Done! Get your credentials for Vercel:"
echo "  turso db show $DB_NAME --url"
echo "  turso db tokens create $DB_NAME"
