# syntax=docker/dockerfile:1

# ============================================================================
# Quackback Docker Build
#
# Features:
#   - Auto-runs migrations on startup (like Grafana, Metabase)
#   - Optional database seeding with SEED_DATABASE=true
#
# Example:
#   docker build -t quackback -f apps/web/Dockerfile .
#   docker run -e DATABASE_URL=... -e SEED_DATABASE=true quackback
# ============================================================================

# Base image with Bun
FROM oven/bun:1.3.11 AS base
WORKDIR /app

# ============================================================================
# Builder stage - install deps and build
# ============================================================================
FROM base AS builder

WORKDIR /app

# Copy source files
COPY package.json bun.lock tsconfig.json ./
COPY apps/web ./apps/web
COPY packages ./packages
COPY scripts ./scripts

# Install all dependencies (including devDependencies for build)
ENV HUSKY=0
RUN bun install --frozen-lockfile

# Set build-time environment
ENV NODE_ENV=production

# Build the widget bundle first — apps/web imports packages/widget/dist/browser.js
# via a Vite ?raw import, so the file must exist before the TanStack Start build runs.
RUN bun run --filter @quackback/widget build

# Build the TanStack Start application
WORKDIR /app/apps/web
RUN bun run build

# Patch Nitro's lazy SSR loading: Nitro 3.x wraps the SSR service in
# `lazyService(() => import('./_ssr/ssr.mjs'))` which only fires the import
# when the FIRST request arrives. That puts ~200ms of module evaluation +
# ~1s of dependency cold-start on the critical path of every cold start.
#
# Inject an unconditional `import("./_ssr/ssr.mjs")` right after the
# services are declared. Bun fires the import as a side effect; by the
# time Knative finishes its pod-readiness propagation (~1s) and forwards
# the buffered request, the SSR module is already in V8's module cache
# and lazyService's loader resolves synchronously. Top-level await (TLA)
# would also work but delays the TCP listen — losing the parallelism
# between Bun module load and Knative routing setup.
RUN sed -i 's|globalThis.__nitro_vite_envs__ = services;|globalThis.__nitro_vite_envs__ = services;\nimport("./_ssr/ssr.mjs").catch(() => {});|' /app/apps/web/.output/server/index.mjs

# Bundle the migration script so the runner doesn't need /app/node_modules.
# The CLI entrypoint at packages/db/src/migrate.ts pulls in dotenv + drizzle-orm
# + postgres + a few node builtins. `bun build --target=bun --bundle` rolls all
# of that into one .mjs the runner can execute with no installed deps. This
# drops the production image from ~2 GB to ~150 MB.
WORKDIR /app
RUN bun build packages/db/src/migrate.ts \
    --target=bun \
    --bundle \
    --outfile=/tmp/migrate.mjs && \
    bun build packages/db/src/seed.ts \
    --target=bun \
    --bundle \
    --outfile=/tmp/seed.mjs

# ============================================================================
# Production runner
# ============================================================================
FROM oven/bun:1.3.11-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user for security (alpine uses addgroup/adduser, not groupadd/useradd)
RUN addgroup -S -g 1001 nodejs && \
    adduser -S -u 1001 -G nodejs quackback

# Copy the built server bundle (self-contained — Nitro inlines all runtime deps)
COPY --from=builder --chown=quackback:nodejs /app/apps/web/.output ./.output

# Copy the bundled migration script + drizzle SQL files. The bundle is a
# single self-contained .mjs (no node_modules required); the SQL files are
# read at runtime by drizzle's migrator.
COPY --from=builder --chown=quackback:nodejs /tmp/migrate.mjs ./migrate.mjs
COPY --from=builder --chown=quackback:nodejs /tmp/seed.mjs ./seed.mjs
COPY --from=builder --chown=quackback:nodejs /app/packages/db/drizzle ./drizzle

# Copy entrypoint script
COPY --chown=quackback:nodejs apps/web/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create writable directories for Bun runtime
RUN mkdir -p /app/.cache && chown -R quackback:nodejs /app/.cache

# Switch to non-root user
USER quackback

# Set Bun's cache directory to a writable location
ENV BUN_INSTALL_CACHE_DIR=/app/.cache

# Migrations folder location (consumed by migrate.mjs via MIGRATIONS_FOLDER env)
ENV MIGRATIONS_FOLDER=/app/drizzle

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Default behavior: run migrations on startup. K8s deployments should set
# SKIP_MIGRATIONS=true and run migrations from a pre-upgrade Helm hook Job
# instead — that way cold starts don't wait on a DB round-trip.
ENTRYPOINT ["./docker-entrypoint.sh"]
