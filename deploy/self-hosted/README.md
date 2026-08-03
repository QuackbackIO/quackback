# Self-Hosted Deployment

Deploy Quackback on your own infrastructure with full control over your data.

## Table of Contents

- [Quick Start](#quick-start)
- [Docker Images](#docker-images)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Building from Source](#building-from-source)
- [Reverse Proxy](#reverse-proxy)
- [Enterprise Edition](#enterprise-edition)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/quackbackio/quackback.git
cd quackback

# Copy and configure environment
cp .env.prod.example .env
# Edit .env — fill in every value (generate secrets with: openssl rand -base64 32)

# Start the application (app + Postgres + Dragonfly + MinIO)
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

Open http://localhost:3000 to access Quackback.

> The root `docker-compose.yml` is **development infrastructure only** (no app service, insecure defaults, world-readable bucket). Always use `docker-compose.prod.yml` for self-hosting.

### Using Docker Run

```bash
docker run -d \
  --name quackback \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/quackback" \
  -e SECRET_KEY="your-secret-key-at-least-32-chars" \
  -e BASE_URL="https://your-domain.com" \
  ghcr.io/quackbackio/quackback:latest
```

---

## Docker Images

Images are published to GitHub Container Registry:

| Tag                 | Description                               |
| ------------------- | ----------------------------------------- |
| `latest`            | Latest stable release (Community Edition) |
| `latest-community`  | Community Edition (same as `latest`)      |
| `latest-enterprise` | Enterprise Edition (includes EE features) |
| `vX.Y.Z`            | Specific version                          |
| `vX.Y.Z-community`  | Specific version, Community Edition       |
| `vX.Y.Z-enterprise` | Specific version, Enterprise Edition      |

```bash
# Pull latest community edition
docker pull ghcr.io/quackbackio/quackback:latest

# Pull specific version
docker pull ghcr.io/quackbackio/quackback:v1.0.0

# Pull enterprise edition
docker pull ghcr.io/quackbackio/quackback:latest-enterprise
```

---

## Environment Variables

### Required

| Variable       | Description                     | Example                                           |
| -------------- | ------------------------------- | ------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string    | `postgresql://user:pass@localhost:5432/quackback` |
| `SECRET_KEY`   | Auth encryption key (32+ chars) | `your-very-long-random-secret-key`                |
| `BASE_URL`     | Public URL of your instance     | `https://feedback.yourcompany.com`                |

### Optional

| Variable               | Description             | Default      |
| ---------------------- | ----------------------- | ------------ |
| `PORT`                 | Server port             | `3000`       |
| `NODE_ENV`             | Environment             | `production` |
| `EMAIL_RESEND_API_KEY` | Email service (Resend)  | -            |
| `EMAIL_FROM`           | From address for emails | -            |

### Integrations (Optional)

| Variable               | Description                |
| ---------------------- | -------------------------- |
| `SLACK_CLIENT_ID`      | Slack OAuth client ID      |
| `SLACK_CLIENT_SECRET`  | Slack OAuth client secret  |
| `LINEAR_CLIENT_ID`     | Linear OAuth client ID     |
| `LINEAR_CLIENT_SECRET` | Linear OAuth client secret |
| `DISCORD_WEBHOOK_URL`  | Discord webhook URL        |

### OAuth Providers (Optional)

| Variable               | Description                 |
| ---------------------- | --------------------------- |
| `GITHUB_CLIENT_ID`     | GitHub OAuth for user login |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret         |
| `GOOGLE_CLIENT_ID`     | Google OAuth for user login |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret         |

---

## Database Setup

Quackback requires PostgreSQL 13+.

### Create Database

```bash
# Using psql
createdb quackback

# Or via SQL
psql -c "CREATE DATABASE quackback;"
```

### Run Migrations

Migrations run automatically on startup. To run manually:

```bash
# If building from source
bun run db:migrate

# Using Docker
docker exec quackback bun run db:migrate
```

### Database Backups

```bash
# Backup
pg_dump -Fc quackback > quackback_backup.dump

# Restore
pg_restore -d quackback quackback_backup.dump
```

### Scheduled Jobs (pg_cron)

Quackback ships a few background jobs that need to run on a schedule. The
provided `docker/postgres/Dockerfile` already enables the `pg_cron` and
`http` (`pg_net`) extensions; if you bring your own Postgres, install both
extensions and add `pg_cron` to `shared_preload_libraries`.

Two jobs are recommended:

1. **SLA escalation tick** — calls the internal endpoint
   `POST /api/v1/internal/sla-tick` every minute. The endpoint is gated by
   the `INTERNAL_TASK_SECRET` env var, which must match the
   `x-internal-secret` header sent by the cron job.
2. **Webhook delivery audit purge** — trims the `webhook_deliveries` audit
   table to ~30 days so it doesn't grow unbounded.

Run the following SQL once against your Quackback database (replace
`http://web:3000` with whatever URL the Postgres container can reach the web
app on, and `your-internal-secret` with the value of `INTERNAL_TASK_SECRET`):

```sql
-- One-time: store the shared secret as a database GUC so the job body
-- doesn't have to hard-code it.
ALTER DATABASE quackback SET app.internal_secret = 'your-internal-secret';

-- SLA escalation tick — every minute
SELECT cron.schedule(
  'quackback-sla-tick',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'http://web:3000/api/v1/internal/sla-tick',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'content-type',     'application/json',
        'x-internal-secret', current_setting('app.internal_secret')
      )
    );
  $$
);

-- Webhook delivery audit purge — daily at 03:00 UTC, keep 30 days
SELECT cron.schedule(
  'quackback-webhook-deliveries-purge',
  '0 3 * * *',
  $$ DELETE FROM webhook_deliveries WHERE attempted_at < now() - interval '30 days' $$
);
```

Inspect, pause or remove jobs:

```sql
SELECT jobid, schedule, jobname, active FROM cron.job;
SELECT cron.unschedule('quackback-sla-tick');
```

> If you don't run pg_cron, you can drive the SLA tick from any external
> scheduler (systemd timer, Kubernetes CronJob, GitHub Actions cron, etc.)
> by issuing the same authenticated `POST` request once per minute.

---

## Building from Source

### Prerequisites

- **Bun** 1.3.3+
- **PostgreSQL** 17+
- **Node.js** 20+ (for some dev tools)

### Build Steps

```bash
# Clone repository
git clone https://github.com/quackbackio/quackback.git
cd quackback

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Run database migrations
bun run db:migrate

# Build the application
bun run build

# Start the server
bun run start
```

### Development Mode

```bash
# One-time setup
bun run setup

# Start development server
bun run dev

# Open http://localhost:3000
```

---

## Reverse Proxy

### Nginx

```nginx
server {
    listen 80;
    server_name feedback.yourcompany.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name feedback.yourcompany.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Caddy

```
feedback.yourcompany.com {
    reverse_proxy localhost:3000
}
```

### Traefik

```yaml
# docker-compose.yml with Traefik labels
services:
  quackback:
    image: ghcr.io/quackbackio/quackback:latest
    labels:
      - 'traefik.enable=true'
      - 'traefik.http.routers.quackback.rule=Host(`feedback.yourcompany.com`)'
      - 'traefik.http.routers.quackback.tls.certresolver=letsencrypt'
```

---

## Enterprise Edition

Enterprise features require a license key:

- **SSO/SAML** - Single sign-on with identity providers
- **SCIM** - Automated user provisioning
- **Audit Logs** - Detailed activity logging

### Running Enterprise Edition

```bash
docker run -d \
  --name quackback \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e SECRET_KEY="..." \
  -e QUACKBACK_LICENSE_KEY="your-license-key" \
  ghcr.io/quackbackio/quackback:latest-enterprise
```

### Obtaining a License

Contact sales@quackback.io for enterprise licensing information.

---

## Upgrading

### Docker Compose

```bash
# 1. Back up your database first
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%Y%m%d).dump

# 2. Pull the latest source + image (bump QUACKBACK_TAG in .env to pin a version)
git pull
docker compose -f docker-compose.prod.yml pull

# 3. Restart — migrations run automatically on startup
docker compose -f docker-compose.prod.yml up -d
```

### Docker Run

```bash
# Stop and remove old container
docker stop quackback
docker rm quackback

# Pull new image
docker pull ghcr.io/quackbackio/quackback:latest

# Start new container (same run command as before)
docker run -d --name quackback ...
```

### From Source

```bash
# Pull latest changes
git pull origin main

# Install dependencies
bun install

# Run migrations
bun run db:migrate

# Rebuild
bun run build

# Restart
bun run start
```

---

## Troubleshooting

### Container Won't Start

Check logs:

```bash
docker logs quackback
```

Common issues:

- Missing required environment variables
- Database connection failed
- Port 3000 already in use

### Database Connection Failed

Verify connection string:

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

For Docker, ensure the database is accessible:

- Use `host.docker.internal` for host machine database on Mac/Windows
- Use container name or network IP for Docker networks

### Migrations Failed

Check database permissions:

```sql
-- User needs CREATE, ALTER, DROP permissions
GRANT ALL PRIVILEGES ON DATABASE quackback TO your_user;
```

### Email Not Sending

Verify Resend configuration:

```bash
# Test API key
curl -X POST 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer re_xxxxx' \
  -H 'Content-Type: application/json' \
  -d '{"from":"test@yourdomain.com","to":"you@example.com","subject":"Test","text":"Test"}'
```

### Performance Issues

- Enable PostgreSQL connection pooling (PgBouncer)
- Increase container memory limits
- Check for slow database queries

---

## One-Click Deployments

### Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/bcnu9a)

Deploys Quackback + PostgreSQL (with pgvector) + S3-compatible storage bucket to Railway. After deploying:

1. **Find your OTP code**: If email is not configured, login codes appear in Railway's deployment logs
2. **Configure email** (recommended): Add SMTP or Resend API key in the service's environment variables
3. **Custom domain**: Add a custom domain in Railway, then update the `BASE_URL` environment variable to match

File uploads (logos, avatars, changelog images) work out of the box via the included Railway storage bucket.

> Railway offers a free trial with $5 credit. See [Railway pricing](https://railway.com/pricing) for details.

Coming soon:

- Render
- DigitalOcean App Platform
- Fly.io

---

## Support

- **Documentation**: https://docs.quackback.io
- **GitHub Issues**: https://github.com/quackbackio/quackback/issues
- **Discord**: https://discord.gg/quackback
