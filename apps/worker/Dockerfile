# syntax=docker/dockerfile:1

# Base image with Bun
FROM oven/bun:1.3.4-slim AS base
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

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user for security
RUN groupadd --system --gid 1001 worker && \
    useradd --system --uid 1001 --gid worker worker

# Copy source files first
COPY --chown=worker:worker package.json bun.lock tsconfig.json ./
COPY --chown=worker:worker apps/worker ./apps/worker
COPY --chown=worker:worker packages ./packages

# Overlay node_modules from deps (root + all workspace packages)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=deps /app/packages/email/node_modules ./packages/email/node_modules
COPY --from=deps /app/packages/ids/node_modules ./packages/ids/node_modules
COPY --from=deps /app/packages/integrations/node_modules ./packages/integrations/node_modules
COPY --from=deps /app/packages/jobs/node_modules ./packages/jobs/node_modules

# Switch to non-root user
USER worker

WORKDIR /app/apps/worker

# Run the worker
CMD ["bun", "run", "src/index.ts"]
