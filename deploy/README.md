# Quackback Deployment

This directory contains deployment configurations for Quackback.

## Deployment Options

| Option                                     | For                                    | Infrastructure       |
| ------------------------------------------ | -------------------------------------- | -------------------- |
| **[Self-Hosted](./self-hosted/README.md)** | Teams running their own infrastructure | Docker, Bun, any VPS |

---

## Self-Hosted (Recommended for most users)

Deploy Quackback on your own infrastructure with full control over your data.

### Quick Start with Docker

```bash
docker run -d \
  --name quackback \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/quackback" \
  -e SECRET_KEY="your-secret-32-chars-minimum" \
  -e BASE_URL="https://your-domain.com" \
  ghcr.io/quackbackio/quackback:latest
```

### With Docker Compose

```bash
git clone https://github.com/quackbackio/quackback.git
cd quackback
cp .env.prod.example .env
# Edit .env with your settings (generate secrets with: openssl rand -base64 32)
docker compose -f docker-compose.prod.yml up -d
```

> The root `docker-compose.yml` is for **local development only** (datastores, no app service). Use `docker-compose.prod.yml` to self-host — it bundles the app plus Postgres and Silo (the maintained MinIO fork) with hardened defaults.

See the [Self-Hosted Guide](./self-hosted/README.md) for complete documentation.

---

## Quackback Cloud

Quackback Cloud runs the same open-source image as self-hosted installs. Its hosting configuration is not part of this repository.

---

## Directory Structure

```
deploy/
├── README.md              # This file
├── railway-template.yml   # One-click Railway template
├── edge/                  # Cloudflare edge-retry worker (not deployed)
└── self-hosted/           # Self-hosting documentation
    └── README.md          # Self-hosted deployment guide
```

---

## Building from source

`bun run build` builds the app. There is one edition: the same build runs self-hosted and on Cloud.

---

## License

The app is licensed under AGPL-3.0 (the `@quackback/widget` package is MIT). There is no closed enterprise edition and no license key: a self-hosted install is entitled to every feature, including OIDC SSO and the audit log.
