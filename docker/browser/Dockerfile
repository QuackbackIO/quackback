# The browser reader: a headless Chromium behind a small read service that
# Quackback calls to measure a website as a browser renders it (Import your
# brand). It holds no secret beyond its own token and keeps nothing between
# reads. Every request a page makes goes through its guard proxy, which
# refuses private and local addresses; that guards the page's requests, not a
# compromised renderer, so Chromium's own sandbox stays on and Compose puts
# this container on a network of its own with the app (no database or storage).
#
# Published as ghcr.io/quackbackio/quackback-browser beside the app image.
# Build from the repository root:
#   docker build -f docker/browser/Dockerfile -t quackback-browser .
# Run (the app sets QUACKBACK_BROWSER_URL and the same token):
#   docker run --security-opt seccomp=docker/browser/seccomp-chromium.json \
#     -e QUACKBACK_BROWSER_TOKEN=<16+ characters> -p 3200:3200 quackback-browser
# The seccomp profile is Docker's default plus the clone and unshare calls
# Chromium's sandbox needs; without it Chromium cannot start its renderers.

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
 && bun build src/lib/server/domains/brand-import/browser/reader-server.ts \
      --target=bun --outfile=/out/reader.js

FROM oven/bun:1.4.0-alpine AS runner
LABEL org.opencontainers.image.source="https://github.com/QuackbackIO/quackback" \
      org.opencontainers.image.description="Quackback's browser reader: renders a website for Import your brand" \
      org.opencontainers.image.licenses="AGPL-3.0"
RUN apk add --no-cache chromium font-noto ttf-freefont \
 && adduser -S -u 1001 reader
WORKDIR /app
COPY --from=builder --chown=reader /out ./
USER reader
ENV NODE_ENV=production \
    PORT=3200 \
    QUACKBACK_BROWSER_PATH=/usr/bin/chromium-browser
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3200/health || exit 1
CMD ["bun", "/app/reader.js"]
