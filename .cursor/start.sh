#!/usr/bin/env bash
# Per-boot startup for the Quackback Cloud Agent environment.
#
# Brings up the local datastores the app depends on (PostgreSQL with pg_cron +
# pgvector, MinIO, Dragonfly, Mailpit) via docker-compose, then applies database
# migrations. Idempotent: safe to run on every boot, tolerates an already-running
# daemon/containers, and only creates databases when missing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DB_URL_DEV="postgresql://postgres:password@localhost:5432/quackback"
DB_URL_TEST="postgresql://postgres:password@localhost:5432/quackback_test"

echo "[start] Ensuring Docker daemon is running..."
if ! sudo docker info >/dev/null 2>&1; then
  sudo bash -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'
  for i in $(seq 1 60); do
    if sudo docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
sudo docker info >/dev/null 2>&1 || { echo "[start] Docker daemon failed to start" >&2; exit 1; }
# Let the non-root user talk to the daemon without sudo for the rest of the session.
sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
echo "[start] Docker is up."

# Create .env from the example if absent, and fill in a SECRET_KEY.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[start] Created .env from .env.example"
fi
if grep -q '^SECRET_KEY=$' .env 2>/dev/null; then
  SECRET="$(openssl rand -hex 32)"
  sed -i "s/^SECRET_KEY=$/SECRET_KEY=$SECRET/" .env
  echo "[start] Generated SECRET_KEY"
fi

echo "[start] Starting datastores (postgres, minio, dragonfly, mailpit)..."
docker compose up -d --wait postgres minio minio-init dragonfly mailpit

# Create the dev and test databases if they do not exist yet. The test DB is
# used by the DB-integration parts of `bun run test`.
for DBNAME in quackback quackback_test; do
  if ! docker compose exec -T postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DBNAME'" | grep -q 1; then
    docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE $DBNAME;"
    echo "[start] Created database $DBNAME"
  fi
done

echo "[start] Applying migrations (dev + test databases)..."
DATABASE_URL="$DB_URL_DEV" bun run db:migrate
DATABASE_URL="$DB_URL_TEST" bun run db:migrate

echo "[start] Ready. Run 'bun run db:seed' for demo data; 'bun run dev' serves http://localhost:3000"
