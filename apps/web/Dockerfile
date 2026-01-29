# syntax=docker/dockerfile:1

# ============================================================================
# Quackback Docker Build
#
# Build args:
#   EDITION: self-hosted (default) | cloud
#
# Example builds:
#   docker build -t quackback .
#   docker build --build-arg EDITION=cloud -t quackback:cloud .
# ============================================================================

ARG EDITION=self-hosted

# Base image with Bun
FROM oven/bun:1.3.7 AS base
WORKDIR /app

# ============================================================================
# Builder stage - install deps and build
# ============================================================================
FROM base AS builder
ARG EDITION

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
ENV EDITION=${EDITION}

# Run edition preparation (route exclusion based on edition)
RUN bun scripts/prepare-edition.ts

# Build the TanStack Start application
WORKDIR /app/apps/web
RUN bun run build

# ============================================================================
# Production runner
# ============================================================================
FROM oven/bun:1.3.7-slim AS runner
ARG EDITION

WORKDIR /app

ENV NODE_ENV=production
ENV EDITION=${EDITION}

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
