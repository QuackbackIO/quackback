# Quackback Deployment

This directory contains deployment configurations for Quackback.

## Deployment Options

| Option                                     | For                          | Infrastructure       |
| ------------------------------------------ | ---------------------------- | -------------------- |
| **[Self-Hosted](./self-hosted/README.md)** | Community & Enterprise users | Docker, Bun, any VPS |
| **[Cloud](./cloud/README.md)**             | Quackback team only          | Cloudflare Workers   |

---

## Self-Hosted (Recommended for most users)

Deploy Quackback on your own infrastructure with full control over your data.

### Quick Start with Docker

```bash
docker run -d \
  --name quackback \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/quackback" \
  -e BETTER_AUTH_SECRET="your-secret-32-chars-minimum" \
  -e BETTER_AUTH_URL="https://your-domain.com" \
  -e ROOT_URL="https://your-domain.com" \
  ghcr.io/quackbackhq/quackback:latest
```

### With Docker Compose

```bash
git clone https://github.com/quackbackhq/quackback.git
cd quackback
cp .env.example .env
# Edit .env with your settings
docker compose up -d
```

See the [Self-Hosted Guide](./self-hosted/README.md) for complete documentation.

---

## Quackback Cloud (Internal)

The `cloud/` directory contains Cloudflare Workers deployment configuration for Quackback Cloud (app.quackback.io).

> **Note**: This is used internally by the Quackback team. Self-hosted users should ignore this directory.

See the [Cloud Deployment Guide](./cloud/README.md) for internal documentation.

---

## Directory Structure

```
deploy/
├── README.md              # This file
├── cloud/                 # Quackback Cloud (Cloudflare Workers)
│   ├── README.md          # Cloud deployment guide
│   ├── wrangler.jsonc     # Base wrangler config
│   ├── wrangler.dev.jsonc # Development environment
│   ├── wrangler.production.jsonc  # Production environment
│   ├── .dev.vars.example  # Secrets template
│   └── .gitignore         # Ignores .dev.vars
└── self-hosted/           # Self-hosting documentation
    └── README.md          # Self-hosted deployment guide
```

---

## Build Variants

Quackback supports different build configurations:

| Command                           | Edition     | EE Features | Target     |
| --------------------------------- | ----------- | ----------- | ---------- |
| `bun run build`                   | Self-hosted | No          | Bun        |
| `bun run build:community`         | Self-hosted | No          | Bun        |
| `bun run build:enterprise`        | Self-hosted | Yes         | Bun        |
| `bun run build:cloud`             | Cloud       | Yes         | Bun        |
| `bun run deploy:cloud:dev`        | Cloud       | Yes         | Cloudflare |
| `bun run deploy:cloud:production` | Cloud       | Yes         | Cloudflare |

The build target is controlled by `DEPLOY_TARGET` environment variable:

- `bun` (default): Uses Nitro with Bun preset for self-hosted deployments
- `cloudflare`: Uses `@cloudflare/vite-plugin` for Cloudflare Workers

---

## License

- **Core**: AGPL-3.0 (open source)
- **Enterprise Features**: Proprietary (requires license key)

Enterprise features include SSO/SAML, SCIM, and Audit Logs. Contact sales@quackback.io for licensing.
