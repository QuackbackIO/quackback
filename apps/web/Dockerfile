# syntax=docker/dockerfile:1

# Base image with Bun (full image for build tools)
FROM oven/bun:1.3.4 AS base
WORKDIR /app

# Install dependencies only when needed
FROM base AS deps

# Copy all workspace package.json files for dependency resolution
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/domain/package.json ./packages/domain/
COPY packages/email/package.json ./packages/email/
COPY packages/ids/package.json ./packages/ids/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/jobs/package.json ./packages/jobs/
COPY ee/package.json ./ee/

# Install dependencies with frozen lockfile for reproducibility
RUN bun install --frozen-lockfile

# Build stage
FROM base AS builder
WORKDIR /app

# Copy source files first
COPY package.json bun.lock tsconfig.json ./
COPY apps/web ./apps/web
COPY packages ./packages
COPY ee ./ee

# Overlay node_modules from deps stage (this will add node_modules dirs)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=deps /app/packages/email/node_modules ./packages/email/node_modules
COPY --from=deps /app/packages/ids/node_modules ./packages/ids/node_modules
COPY --from=deps /app/packages/integrations/node_modules ./packages/integrations/node_modules
COPY --from=deps /app/packages/jobs/node_modules ./packages/jobs/node_modules
COPY --from=deps /app/ee/node_modules ./ee/node_modules

# Set build-time environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js application
WORKDIR /app/apps/web
RUN bun --bun ./node_modules/.bin/next build

# Production image (slim for smaller size)
FROM oven/bun:1.3.4-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Copy the standalone output (Next.js bundles all needed files)
COPY --from=builder /app/apps/web/public ./public

# Create .next directory with proper permissions
RUN mkdir -p .next && chown nextjs:nodejs .next

# Copy standalone build and static files
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Switch to non-root user
USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run with bun for better performance
CMD ["bun", "apps/web/server.js"]
