#!/bin/bash
# Bootstraps a linked git worktree for local dev: real `bun install` (not a
# node_modules symlink, which silently resolves packages/* back to the
# canonical checkout), builds the gitignored artifacts the app can't run
# without, and gives the worktree its own port + Postgres database + Redis
# namespace so it can run alongside other worktrees without fighting over
# shared dev data.
#
# Usage: run from anywhere inside the worktree, e.g.:
#   ./scripts/worktree-bootstrap.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
WORKTREE_ROOT="$(pwd)"
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

if [ "$WORKTREE_ROOT" = "$MAIN_ROOT" ]; then
  echo "This is the main checkout, not a linked worktree. Nothing to bootstrap."
  exit 0
fi

echo "Bootstrapping worktree: $WORKTREE_ROOT"
echo ""

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------
echo "Installing dependencies..."
bun install --frozen-lockfile
echo ""

# ---------------------------------------------------------------------------
# 2. packages/widget/dist — apps/web/src/routes/api/widget/sdk[.]js.ts does a
#    Vite ?raw import of it; without it, every route 500s in dev.
# ---------------------------------------------------------------------------
echo "Building widget bundle..."
bun run --cwd packages/widget build
echo ""

# ---------------------------------------------------------------------------
# 3. Per-worktree .env — reuse the canonical checkout's secrets, but this
#    worktree gets its own PORT, Postgres database, and Redis DB index so it
#    doesn't collide with other worktrees' dev servers/tests.
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  if [ -f "$MAIN_ROOT/.env" ]; then
    cp "$MAIN_ROOT/.env" .env
    echo "Created .env from the canonical checkout's .env"
  else
    cp .env.example .env
    echo "Created .env from .env.example (no canonical .env found at $MAIN_ROOT)"
  fi
fi

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    local escaped
    escaped="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
    sed -i.bak -E "s|^${key}=.*|${key}=${escaped}|" .env
    rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}

read_env() {
  sed -n -E "s/^$1=[\"']?([^\"']*)[\"']?.*/\1/p" .env | head -1
}

port_in_use() {
  lsof -iTCP:"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1
}

# Every worktree targets the SAME docker-compose containers (they have fixed
# container_name entries) — pin the project name via .env so `docker compose
# up` recognizes them instead of trying to stand up a second stack under
# this worktree's directory name (which conflicts on container names).
set_env COMPOSE_PROJECT_NAME quackback

slug="$(basename "$WORKTREE_ROOT" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g')"
slug="${slug:0:40}"

# Reuse the worktree's own PORT on a re-run, but not one it merely inherited
# by copying the main checkout's .env — that would collide with the main dev
# server. A value equal to main's counts as unassigned, so fall through to
# allocation (mirrors the DATABASE_URL != "quackback" guard below).
main_port=""
[ -f "$MAIN_ROOT/.env" ] && main_port="$(sed -n -E 's/^PORT=([0-9]+).*/\1/p' "$MAIN_ROOT/.env" | head -1)"
existing_port="$(read_env PORT)"
if [ -n "$existing_port" ] && [ "$existing_port" != "$main_port" ]; then
  port="$existing_port"
else
  claimed_ports=()
  while IFS= read -r wt_path; do
    [ "$wt_path" = "$WORKTREE_ROOT" ] && continue
    [ -f "$wt_path/.env" ] || continue
    p="$(sed -n -E 's/^PORT=([0-9]+).*/\1/p' "$wt_path/.env" | head -1)"
    [ -n "$p" ] && claimed_ports+=("$p")
  done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')

  port=""
  for candidate in $(seq 3001 3099); do
    skip=""
    for c in "${claimed_ports[@]:-}"; do [ "$c" = "$candidate" ] && skip=1; done
    [ -n "$skip" ] && continue
    port_in_use "$candidate" && continue
    port="$candidate"
    break
  done
  [ -n "$port" ] || {
    echo "No free port found in 3001-3099" >&2
    exit 1
  }
fi

existing_database_url="$(read_env DATABASE_URL)"
if [[ "$existing_database_url" =~ /([A-Za-z0-9_]+)$ ]] && [ "${BASH_REMATCH[1]}" != "quackback" ]; then
  db_name="${BASH_REMATCH[1]}"
else
  db_name="quackback_${slug}"
fi

# Same guard as PORT: a Redis DB index inherited from the main checkout's
# .env would share its namespace, so only reuse an index that differs from
# main's.
main_redis_idx=""
[ -f "$MAIN_ROOT/.env" ] && main_redis_idx="$(sed -n -E 's#^REDIS_URL=redis://[^/]+/([0-9]+).*#\1#p' "$MAIN_ROOT/.env" | head -1)"
existing_redis_url="$(read_env REDIS_URL)"
if [[ "$existing_redis_url" =~ ^redis://[^/]+/([0-9]+)$ ]] && [ "${BASH_REMATCH[1]}" != "$main_redis_idx" ]; then
  redis_idx="${BASH_REMATCH[1]}"
else
  claimed_redis_idx=()
  while IFS= read -r wt_path; do
    [ "$wt_path" = "$WORKTREE_ROOT" ] && continue
    [ -f "$wt_path/.env" ] || continue
    r="$(sed -n -E 's#^REDIS_URL=redis://[^/]+/([0-9]+).*#\1#p' "$wt_path/.env" | head -1)"
    [ -n "$r" ] && claimed_redis_idx+=("$r")
  done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')

  redis_idx=""
  for candidate in $(seq 1 15); do
    skip=""
    for c in "${claimed_redis_idx[@]:-}"; do [ "$c" = "$candidate" ] && skip=1; done
    [ -n "$skip" ] && continue
    redis_idx="$candidate"
    break
  done
  [ -n "$redis_idx" ] || {
    echo "No free Redis DB index found in 1-15" >&2
    exit 1
  }
fi

set_env PORT "$port"
set_env BASE_URL "http://localhost:${port}"
set_env TRUSTED_ORIGINS "http://localhost:${port},http://acme.localhost:${port}"
set_env DATABASE_URL "postgresql://postgres:password@localhost:5432/${db_name}"
set_env REDIS_URL "redis://localhost:6379/${redis_idx}"

echo "Worktree config: PORT=$port  DATABASE_URL=.../${db_name}  REDIS_URL=.../${redis_idx}"
echo ""

# ---------------------------------------------------------------------------
# 4. Shared dev infra (Postgres, MinIO, Dragonfly, Mailpit)
# ---------------------------------------------------------------------------
echo "Ensuring shared dev infra is up..."
docker compose up -d postgres minio minio-init dragonfly mailpit
echo ""

echo "Waiting for Postgres..."
until docker exec quackback-db pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

# ---------------------------------------------------------------------------
# 5. This worktree's own database
# ---------------------------------------------------------------------------
exists="$(docker exec quackback-db psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'")"
if [ "$exists" != "1" ]; then
  echo "Creating database ${db_name}..."
  docker exec quackback-db createdb -U postgres "$db_name"
fi

echo "Running migrations..."
DATABASE_URL="postgresql://postgres:password@localhost:5432/${db_name}" bun run --cwd packages/db db:migrate
echo ""

# ---------------------------------------------------------------------------
# 6. routeTree.gen.ts — generated by the TanStack Router Vite plugin; there's
#    no standalone CLI for it, so boot the dev server just long enough for
#    it to write the file, then stop it.
# ---------------------------------------------------------------------------
if [ ! -f apps/web/src/routeTree.gen.ts ]; then
  echo "Generating routeTree.gen.ts (booting dev server briefly)..."
  vite_log="$(mktemp)"
  vite_pidfile="$(mktemp)"
  (
    cd apps/web
    setsid bash -c 'exec bun --env-file=../../.env vite dev' >"$vite_log" 2>&1 &
    echo $! >"$vite_pidfile"
  )

  generated=""
  for _ in $(seq 1 90); do
    if [ -f apps/web/src/routeTree.gen.ts ]; then
      generated=1
      break
    fi
    sleep 1
  done
  sleep 1 # let the write settle

  vite_pid="$(cat "$vite_pidfile")"
  kill -TERM "-$vite_pid" 2>/dev/null || true
  sleep 1
  kill -KILL "-$vite_pid" 2>/dev/null || true
  rm -f "$vite_pidfile"

  if [ -z "$generated" ]; then
    echo "routeTree.gen.ts was not generated within 90s — check $vite_log" >&2
    exit 1
  fi
  rm -f "$vite_log"
fi

echo "Bootstrap complete!"
echo ""
echo "Next steps:"
echo "  bun run dev              # dev server at http://localhost:${port}"
echo "  bun run db:seed          # optional demo data"
echo "  bun run test             # unit tests (uses the shared quackback_test DB)"
