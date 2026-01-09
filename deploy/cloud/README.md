# Quackback Cloud Deployment

> **Internal Use Only**: This directory contains deployment configuration for Quackback Cloud
> (app.quackback.io). It is NOT intended for self-hosted deployments.
>
> For self-hosting, see: [Self-Hosted Guide](../self-hosted/README.md)

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [First-Time Setup](#first-time-setup)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [GitHub Actions CI/CD](#github-actions-cicd)
- [Troubleshooting](#troubleshooting)

---

## Architecture

Quackback Cloud runs on Cloudflare Workers with:

| Component              | Technology                                       |
| ---------------------- | ------------------------------------------------ |
| **Runtime**            | Cloudflare Workers via `@cloudflare/vite-plugin` |
| **Framework**          | TanStack Start (React)                           |
| **Database**           | Neon PostgreSQL (per-tenant)                     |
| **Connection Pooling** | Cloudflare Hyperdrive                            |
| **Multi-tenancy**      | Domain-based resolution via catalog database     |

### Environments

| Environment | Domain Pattern       | Worker Name         | Hyperdrive |
| ----------- | -------------------- | ------------------- | ---------- |
| Development | `*.dev.quackback.io` | `quackback-web-dev` | Dev pool   |
| Production  | `*.quackback.io`     | `quackback-web`     | Prod pool  |

---

## Prerequisites

Before deploying, ensure you have:

1. **Cloudflare Account** with Workers paid plan
2. **Wrangler CLI** installed: `bun add -g wrangler`
3. **Cloudflare API Token** with these permissions:
   - Account: Cloudflare Workers Scripts:Edit
   - Zone: quackback.io - Workers Routes:Edit
4. **Hyperdrive** configured in Cloudflare dashboard (already set up)
5. **Catalog Database** PostgreSQL database for workspace registry

---

## First-Time Setup

### 1. Authenticate with Cloudflare

```bash
wrangler login
```

This opens a browser to authenticate. Your credentials are stored locally.

### 2. Create Local Secrets File

```bash
cd deploy/cloud
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your development secrets:

```bash
# Required
BETTER_AUTH_SECRET=your-dev-secret-at-least-32-characters
CLOUD_CATALOG_DATABASE_URL=postgres://user:pass@host/catalog
CLOUD_NEON_API_KEY=napi_xxxxxxxxxxxx
RESEND_API_KEY=re_xxxxxxxxxxxx
INTEGRATION_ENCRYPTION_KEY=base64-encoded-32-byte-key

# Optional (for OAuth testing)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### 3. Configure Cloudflare Secrets (for deployed workers)

Secrets must be set via wrangler for each environment:

```bash
# Development environment
cd apps/web
wrangler secret put BETTER_AUTH_SECRET -c ../../deploy/cloud/wrangler.dev.jsonc
wrangler secret put CLOUD_CATALOG_DATABASE_URL -c ../../deploy/cloud/wrangler.dev.jsonc
wrangler secret put CLOUD_NEON_API_KEY -c ../../deploy/cloud/wrangler.dev.jsonc
wrangler secret put RESEND_API_KEY -c ../../deploy/cloud/wrangler.dev.jsonc
wrangler secret put INTEGRATION_ENCRYPTION_KEY -c ../../deploy/cloud/wrangler.dev.jsonc

# Production environment
wrangler secret put BETTER_AUTH_SECRET -c ../../deploy/cloud/wrangler.production.jsonc
wrangler secret put CLOUD_CATALOG_DATABASE_URL -c ../../deploy/cloud/wrangler.production.jsonc
wrangler secret put CLOUD_NEON_API_KEY -c ../../deploy/cloud/wrangler.production.jsonc
wrangler secret put RESEND_API_KEY -c ../../deploy/cloud/wrangler.production.jsonc
wrangler secret put INTEGRATION_ENCRYPTION_KEY -c ../../deploy/cloud/wrangler.production.jsonc
```

---

## Local Development

### Running Locally with Wrangler

For local development that simulates the Cloudflare environment:

```bash
# From apps/web directory
cd apps/web

# Build for Cloudflare
bun run build:cloud

# Run locally with wrangler
wrangler dev -c ../../deploy/cloud/wrangler.dev.jsonc
```

This uses Hyperdrive's `localConnectionString` to connect to your local PostgreSQL.

### Standard Local Development

For faster iteration, use the standard dev server (runs on Bun, not Workers):

```bash
bun run dev
```

---

## Deployment

### Manual Deployment

#### Deploy to Development

```bash
# From repository root
bun run deploy:cloud:dev

# Or from apps/web
cd apps/web
bun run deploy:dev
```

This deploys to:

- `main.dev.quackback.io`
- `storefeeder.dev.quackback.io`
- Other `*.dev.quackback.io` subdomains

#### Deploy to Production

```bash
# From repository root
bun run deploy:cloud:production

# Or from apps/web
cd apps/web
bun run deploy:production
```

This deploys to:

- `app.quackback.io`
- `*.quackback.io` (wildcard)

### What Happens During Deployment

1. **Build**: `EDITION=cloud vite build`
   - Loads `@cloudflare/vite-plugin` when EDITION=cloud
   - Outputs to `dist/client/` and `dist/server/`
   - Generates `wrangler.json` with entry point

2. **Deploy**: `wrangler deploy -c ../../deploy/cloud/wrangler.{env}.jsonc`
   - Uploads worker code to Cloudflare
   - Configures routes, bindings, and environment variables
   - Does NOT upload secrets (those are set separately)

---

## GitHub Actions CI/CD

Automated deployments are configured in `.github/workflows/deploy-cloud.yml`.

### How It Works

| Trigger         | Environment               | Action                         |
| --------------- | ------------------------- | ------------------------------ |
| Push to `main`  | Development               | Auto-deploy                    |
| Manual dispatch | Development or Production | Deploy to selected environment |

### Setting Up GitHub Environments

1. Go to **Repository Settings > Environments**

2. Create **development** environment:
   - No protection rules needed
   - Add secrets (see below)

3. Create **production** environment:
   - Add required reviewers (recommended)
   - Add secrets (see below)

### Required Secrets per Environment

| Secret                       | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | API token with Workers permissions                  |
| `BETTER_AUTH_SECRET`         | Auth encryption key (32+ chars)                     |
| `CLOUD_CATALOG_DATABASE_URL` | Catalog database connection string                  |
| `CLOUD_NEON_API_KEY`         | Neon API key for fetching tenant connection strings |
| `RESEND_API_KEY`             | Email service API key                               |

### Manual Production Deploy

1. Go to **Actions > Deploy Cloud**
2. Click **Run workflow**
3. Select **production** from dropdown
4. Click **Run workflow**
5. If protection rules are set, approve the deployment

---

## Configuration Files

| File                        | Purpose                                |
| --------------------------- | -------------------------------------- |
| `wrangler.jsonc`            | Base configuration (not used directly) |
| `wrangler.dev.jsonc`        | Development environment config         |
| `wrangler.production.jsonc` | Production environment config          |
| `.dev.vars.example`         | Template for local secrets             |
| `.dev.vars`                 | Local secrets (gitignored)             |

### Key Configuration Options

```jsonc
{
  "name": "quackback-web-dev",           // Worker name
  "main": "@tanstack/react-start/server-entry",  // Entry point
  "compatibility_flags": ["nodejs_compat"],      // Node.js APIs
  "routes": [...],                        // Domain routing
  "hyperdrive": [{                        // Database pooling
    "binding": "HYPERDRIVE",
    "id": "..."
  }],
  "vars": {                               // Non-secret env vars
    "EDITION": "cloud",
    "NODE_ENV": "development"
  }
}
```

---

## Troubleshooting

### Build Fails with "Cannot find @cloudflare/vite-plugin"

Ensure the plugin is installed:

```bash
cd apps/web
bun add -D @cloudflare/vite-plugin wrangler
```

### "Hyperdrive binding not found"

The Hyperdrive ID in wrangler config must match one configured in Cloudflare dashboard.
Check: **Cloudflare Dashboard > Workers > Hyperdrive**

### "Authentication required"

Run `wrangler login` to authenticate with Cloudflare.

### Secrets Not Working

Secrets set via `wrangler secret put` are separate from `vars` in the config:

- `vars`: Non-sensitive, visible in dashboard
- Secrets: Encrypted, set via CLI or dashboard

### Deployment Succeeds but Site Shows Errors

1. Check worker logs: **Cloudflare Dashboard > Workers > quackback-web-dev > Logs**
2. Verify secrets are set: `wrangler secret list -c ../../deploy/cloud/wrangler.dev.jsonc`
3. Check Hyperdrive connection: Ensure database is accessible

### Local Dev Can't Connect to Database

The `localConnectionString` in wrangler config is used for local dev:

```jsonc
"hyperdrive": [{
  "binding": "HYPERDRIVE",
  "id": "...",
  "localConnectionString": "postgresql://postgres:password@localhost:5432/quackback"
}]
```

Update this to match your local PostgreSQL setup.

---

## Quick Reference

```bash
# Build for Cloudflare (from apps/web)
bun run build:cloud

# Deploy to dev (from root)
bun run deploy:cloud:dev

# Deploy to production (from root)
bun run deploy:cloud:production

# Set a secret
wrangler secret put SECRET_NAME -c ../../deploy/cloud/wrangler.dev.jsonc

# List secrets
wrangler secret list -c ../../deploy/cloud/wrangler.dev.jsonc

# View logs
wrangler tail -c ../../deploy/cloud/wrangler.dev.jsonc

# Run locally
wrangler dev -c ../../deploy/cloud/wrangler.dev.jsonc
```
