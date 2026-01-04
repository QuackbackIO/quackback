# syntax=docker/dockerfile:1

# ============================================================================
# Quackback Docker Build
#
# Build args:
#   EDITION: self-hosted (default) | cloud
#   INCLUDE_EE: false (default) | true
#
# Example builds:
#   docker build -t quackback:community .
#   docker build --build-arg EDITION=cloud -t quackback:cloud .
#   docker build --build-arg INCLUDE_EE=true -t quackback:enterprise .
# ============================================================================

ARG EDITION=self-hosted
ARG INCLUDE_EE=false

# Base image with Bun
FROM oven/bun:1.3.4 AS base
WORKDIR /app

# ============================================================================
# Dependencies stage
# ============================================================================
FROM base AS deps
ARG INCLUDE_EE

# Copy workspace package files for dependency resolution
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/domain/package.json ./packages/domain/
COPY packages/email/package.json ./packages/email/
COPY packages/ids/package.json ./packages/ids/
COPY packages/integrations/package.json ./packages/integrations/

# Conditionally copy EE package definitions
# The `|| true` ensures this doesn't fail if ee/ doesn't exist
COPY ee/package.json ./ee/ 2>/dev/null || true
COPY ee/packages/sso/package.json ./ee/packages/sso/ 2>/dev/null || true
COPY ee/packages/scim/package.json ./ee/packages/scim/ 2>/dev/null || true
COPY ee/packages/audit/package.json ./ee/packages/audit/ 2>/dev/null || true

# Install dependencies
RUN bun install --frozen-lockfile

# ============================================================================
# Builder stage
# ============================================================================
FROM base AS builder
ARG EDITION
ARG INCLUDE_EE

WORKDIR /app

# Copy source files
COPY package.json bun.lock tsconfig.json ./
COPY apps/web ./apps/web
COPY packages ./packages
COPY scripts ./scripts

# Conditionally copy EE packages
COPY ee ./ee 2>/dev/null || true

# Overlay node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/email/node_modules ./packages/email/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/ids/node_modules ./packages/ids/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/integrations/node_modules ./packages/integrations/node_modules 2>/dev/null || true
COPY --from=deps /app/ee/node_modules ./ee/node_modules 2>/dev/null || true

# Set build-time environment
ENV NODE_ENV=production
ENV EDITION=${EDITION}
ENV INCLUDE_EE=${INCLUDE_EE}

# Run edition preparation (route exclusion based on edition)
RUN bun scripts/prepare-edition.ts

# Build the TanStack Start application
WORKDIR /app/apps/web
RUN bun --bun vite build

# ============================================================================
# Production runner
# ============================================================================
FROM oven/bun:1.3.4-slim AS runner
ARG EDITION

WORKDIR /app

ENV NODE_ENV=production
ENV EDITION=${EDITION}

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs quackback

# Copy the built output
COPY --from=builder --chown=quackback:nodejs /app/apps/web/.output ./.output

# Switch to non-root user
USER quackback

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run with bun
CMD ["bun", ".output/server/index.mjs"]
