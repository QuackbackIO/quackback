# The website reader: a headless Chromium behind a small read service that
# Quackback calls to read a website as a browser renders it. It holds no
# secret beyond its own token, and every request a page makes goes through
# its guard, which reaches public hosts only.
#
# Build from the repository root:
#   docker build -f docker/browser/Dockerfile -t quackback-browser .

FROM oven/bun:1.4.0 AS builder
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/web ./apps/web
COPY packages ./packages
COPY scripts ./scripts
ENV HUSKY=0
RUN bun install --frozen-lockfile
WORKDIR /app/apps/web
RUN mkdir -p /out \
 && bun build src/lib/server/domains/design/render/reader-server.ts --target=bun --outfile=/out/reader.js \
 && cp "$(dirname "$(bun -e "console.log(Bun.resolveSync('@duckduckgo/autoconsent', process.cwd()))")")/autoconsent.standalone.js" /out/consent.js

FROM oven/bun:1.4.0-alpine AS runner
RUN apk add --no-cache chromium \
 && adduser -S -u 1001 reader
WORKDIR /app
COPY --from=builder --chown=reader /out ./
USER reader
ENV NODE_ENV=production \
    PORT=3200 \
    QUACKBACK_BROWSER_CONSENT_SCRIPT=/app/consent.js \
    # A container cannot give Chromium the namespaces its own sandbox needs.
    # The container is the boundary: it holds no secrets and reaches public hosts only.
    QUACKBACK_BROWSER_SANDBOX=off
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3200/health || exit 1
CMD ["bun", "/app/reader.js"]
