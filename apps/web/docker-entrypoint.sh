#!/bin/sh
set -e

echo "========================================"
echo "  Featurepool starting..."
echo "========================================"

# Run database migrations
echo ""
echo "Running database migrations..."
cd /app/packages/db
bun src/migrate.ts
echo "Migrations complete."

# Optionally seed the database
if [ "$SEED_DATABASE" = "true" ]; then
  echo ""
  echo "Seeding database..."
  bun src/seed.ts
  echo "Seeding complete."
fi

# Start the application
echo ""
echo "Starting Featurepool server on port ${PORT:-5435}..."
echo "========================================"
cd /app
exec bun .output/server/index.mjs
