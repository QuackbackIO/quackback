# syntax=docker/dockerfile:1

# ============================================================================
# Quackback Docker Build
#
# Example:
#   docker build -t quackback .
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

# Create writable directories for Bun runtime
RUN mkdir -p /app/.cache && chown -R quackback:nodejs /app/.cache

# Switch to non-root user
USER quackback

# Set Bun's cache directory to a writable location
ENV BUN_INSTALL_CACHE_DIR=/app/.cache

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run with bun
CMD ["bun", ".output/server/index.mjs"]
