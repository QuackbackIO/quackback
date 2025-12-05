FROM oven/bun:1.3.3-slim AS base

# Install dependencies
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN bun install --frozen-lockfile

# Build stage
FROM base AS runner
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages ./packages

# Copy source code
COPY apps/worker ./apps/worker
COPY packages ./packages
COPY tsconfig.json ./

# Set working directory to worker
WORKDIR /app/apps/worker

# Set environment
ENV NODE_ENV=production

# Run the worker
CMD ["bun", "run", "src/index.ts"]
