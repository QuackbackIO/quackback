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

echo "[install] Done."
