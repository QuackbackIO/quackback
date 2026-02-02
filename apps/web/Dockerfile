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
FROM oven/bun:1.3.7 AS base
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
RUN bun install --frozen-lockfile

# Set build-time environment
ENV NODE_ENV=production

# Build the TanStack Start application
WORKDIR /app/apps/web
RUN bun run build

# ============================================================================
# Production runner
# ============================================================================
FROM oven/bun:1.3.7-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs quackback

# Copy the built output
COPY --from=builder --chown=quackback:nodejs /app/apps/web/.output ./.output

# Copy packages/db for migrations and seeding
COPY --from=builder --chown=quackback:nodejs /app/packages/db ./packages/db

# Copy packages/ids (dependency for seeds)
COPY --from=builder --chown=quackback:nodejs /app/packages/ids ./packages/ids

# Copy node_modules for runtime scripts
COPY --from=builder --chown=quackback:nodejs /app/node_modules ./node_modules

# Copy entrypoint script
COPY --chown=quackback:nodejs apps/web/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create writable directories for Bun runtime
RUN mkdir -p /app/.cache && chown -R quackback:nodejs /app/.cache

# Switch to non-root user
USER quackback

# Set Bun's cache directory to a writable location
ENV BUN_INSTALL_CACHE_DIR=/app/.cache

# Set migrations folder for Docker context
ENV MIGRATIONS_FOLDER=/app/packages/db/drizzle

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run migrations on startup, then start the app
ENTRYPOINT ["./docker-entrypoint.sh"]
