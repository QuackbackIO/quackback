#!/usr/bin/env bash
# Repository bootstrap for the Quackback Cloud Agent environment.
#
# Runs after the source is checked out. Installs JS dependencies and builds the
# widget bundle that the web build imports (packages/widget/dist/browser.js).
# Must be idempotent and must NOT start long-running processes or depend on the
# datastores (those are handled per-boot by start.sh).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[install] Installing dependencies with Bun..."
bun install --frozen-lockfile

# apps/web imports packages/widget/dist/browser.js via Vite `?raw`, so the
# widget must be built before any web build. This is fast (tsup) and safe to
# re-run.
echo "[install] Building @quackback/widget bundle..."
bun run --filter @quackback/widget build

# Snapshot the datastore images so start.sh is not paying pull/build on every
# agent VM. dockerd is only up for this step.
echo "[install] Prefetching datastore images..."
if ! sudo docker info >/dev/null 2>&1; then
  sudo bash -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'
  for i in $(seq 1 60); do
    if sudo docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
if sudo docker info >/dev/null 2>&1; then
  sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
  docker compose pull postgres minio dragonfly mailpit minio-init
  docker compose build postgres
  sudo kill "$(pidof dockerd)" 2>/dev/null || true
  for i in $(seq 1 30); do
    if ! sudo docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
else
  echo "[install] Docker daemon failed to start; images will be pulled on first start" >&2
fi

echo "[install] Done."
