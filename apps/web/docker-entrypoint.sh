#!/bin/sh
set -e

echo "========================================"
echo "  Quackback starting..."
echo "========================================"

# Migrations: skipped in K8s where a pre-upgrade Helm hook Job runs them
# before pods roll. Set SKIP_MIGRATIONS=true to opt out of the on-start
# migration step. Default behavior matches `docker run` ergonomics.
if [ "$SKIP_MIGRATIONS" = "true" ]; then
  echo ""
  echo "SKIP_MIGRATIONS=true — skipping startup migration (handled out-of-band)"
else
  echo ""
  echo "Running database migrations..."
  bun /app/migrate.mjs
  echo "Migrations complete."
fi

# Optionally seed the database
if [ "$SEED_DATABASE" = "true" ]; then
  echo ""
  echo "Seeding database..."
  bun /app/seed.mjs
  echo "Seeding complete."
fi

# Start the application
echo ""
echo "Starting Quackback server on port ${PORT:-3000}..."
echo "========================================"
exec bun .output/server/index.mjs
