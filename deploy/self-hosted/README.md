# Self-Hosted Deployment

Deploy Quackback on your own infrastructure with full control over your data.

## Table of Contents

- [Quick Start](#quick-start)
- [Docker Images](#docker-images)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Building from Source](#building-from-source)
- [Reverse Proxy](#reverse-proxy)
- [Scaling Out](#scaling-out)
- [Upgrading](#upgrading)
  - [Upgrading from 0.13](#upgrading-from-013)
- [Troubleshooting](#troubleshooting)
- [One-Click Deployments](#one-click-deployments)

---

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/quackbackio/quackback.git
cd quackback

# Copy and configure environment
cp .env.prod.example .env
# Edit .env: fill in every value (generate secrets with: openssl rand -base64 32)

# Start the application (app + Postgres + Silo object storage)
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

Open http://localhost:3000 to access Quackback.

> The root `docker-compose.yml` is **development infrastructure only** (no app service, insecure defaults, world-readable bucket). Always use `docker-compose.prod.yml` for self-hosting.

### Using Docker Run

Bring your own PostgreSQL (see [Database Setup](#database-setup) for the requirements):

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

Images are published to GitHub Container Registry as `ghcr.io/quackbackio/quackback`, for `linux/amd64` and `linux/arm64`:

| Tag      | Description                                                       |
| -------- | ----------------------------------------------------------------- |
| `latest` | Latest stable release                                             |
| `X.Y.Z`  | A specific release, for example `0.14.0` (no `v` prefix)          |
| `main`   | Latest build of the `main` branch; unreleased, not for production |

```bash
# Pull the latest release
docker pull ghcr.io/quackbackio/quackback:latest

# Pull a specific release (recommended for production)
docker pull ghcr.io/quackbackio/quackback:0.14.0
```

With `docker-compose.prod.yml`, pin the release with `QUACKBACK_TAG` in `.env`.

---

## Environment Variables

### Required

| Variable       | Description                     | Example                                           |
| -------------- | ------------------------------- | ------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string    | `postgresql://user:pass@localhost:5432/quackback` |
| `SECRET_KEY`   | Auth encryption key (32+ chars) | `your-very-long-random-secret-key`                |
| `BASE_URL`     | Public URL of your instance     | `https://feedback.yourcompany.com`                |

### Optional

| Variable                           | Description                                                                                                                                                                                                                                                              | Default      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `PORT`                             | Server port                                                                                                                                                                                                                                                              | `3000`       |
| `NODE_ENV`                         | Environment                                                                                                                                                                                                                                                              | `production` |
| `QUACKBACK_ROLE`                   | Process role: `all`, `web`, or `worker` (see [Scaling Out](#scaling-out))                                                                                                                                                                                                | `all`        |
| `SKIP_MIGRATIONS`                  | Skip the startup migration step (run migrations out-of-band instead)                                                                                                                                                                                                     | `false`      |
| `SETUP_OWNER_EMAIL`                | Hands an unfinished setup to this address. Use it when the first account created is not yours or you can't sign in to it, then restart; that address can create its account and finish setup. No effect once setup is finished                                           | -            |
| `EMAIL_SMTP_HOST`                  | SMTP server for outbound email; with `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASS`                                                                                                                                                                             | -            |
| `EMAIL_RESEND_API_KEY`             | Resend API key for outbound email (`RESEND_API_KEY` also works). Also fetches inbound mail bodies when receiving through Resend                                                                                                                                          | -            |
| `EMAIL_SES_ACCESS_KEY_ID`          | Amazon SES sending key id; needs `EMAIL_SES_SECRET_ACCESS_KEY` and `EMAIL_SES_REGION` too                                                                                                                                                                                | -            |
| `EMAIL_SES_MAX_SEND_RATE`          | Most SES sends per second from each app process; sends beyond it wait their turn. The quota is per AWS account, so with N processes sending set roughly the account quota (`aws ses get-send-quota`) divided by N                                                        | `10`         |
| `EMAIL_SES_IDENTITY_ACCESS_KEY_ID` | Separate SES key id used only to verify a customer-owned sending domain; needs `EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY`. Grant `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, `ses:PutEmailIdentityMailFromAttributes` and NOT `ses:DeleteEmailIdentity`               | -            |
| `EMAIL_FROM`                       | From address for emails. Configure exactly one sending provider (SMTP, Amazon SES or Resend): with more than one set, the app refuses to start and names the variables. A Resend key kept only for inbound mail beside SMTP or SES needs `EMAIL_INBOUND_PROVIDER=resend` | -            |

### Sign-in Providers and Integrations

Sign-in providers (GitHub, Google, Microsoft, custom OIDC) and integrations (Slack, Linear, Jira and others) are configured in the admin UI under Settings, and their credentials are stored encrypted in the database. No environment variables are needed.

To supply integration OAuth app credentials from the environment instead, set `PLATFORM_CREDENTIALS_SOURCE=env` and the `INTEGRATION_<TYPE>_<FIELD>` variables, for example `INTEGRATION_SLACK_CLIENT_ID` and `INTEGRATION_SLACK_CLIENT_SECRET`. Sign-in provider credentials are always configured in the admin UI.

---

## Database Setup

Quackback requires:

- **PostgreSQL 14** or newer
- **pgvector 0.5.0** or newer (the `vector` extension)
- The **`pg_trgm`** extension (part of the PostgreSQL contrib package)

`docker-compose.prod.yml` builds a PostgreSQL image that meets all three. For your own server, the `pgvector/pgvector` Docker image works, or install pgvector and contrib from your distribution. The app creates both extensions on startup if its database user is allowed to; otherwise, have a superuser run `CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;` in the Quackback database first. Startup checks these requirements before running migrations and exits with a message naming anything missing.

`DATABASE_URL` must be a direct or session-mode connection. Transaction-mode poolers are not supported, because realtime features use `LISTEN`/`NOTIFY`.

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
docker exec quackback bun /app/migrate.mjs
```

### Database Backups

```bash
# Backup
pg_dump -Fc quackback > quackback_backup.dump

# Restore
pg_restore -d quackback quackback_backup.dump
```

---

## Building from Source

### Prerequisites

- **Bun** 1.4.0+
- **PostgreSQL** 14+ with pgvector 0.5.0+ and `pg_trgm` (see [Database Setup](#database-setup))
- **Docker**, for the development database and object storage started by `bun run setup`

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
bun run --filter @quackback/web start
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

    # Feedback videos may be up to 100 MB. Leave room for multipart overhead.
    client_max_body_size 110m;

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

This config sets `X-Real-IP` to the address nginx saw and overwrites any copy the client sent, so you can tell Quackback to read the client IP from it instead of counting hops:

```bash
TRUSTED_CLIENT_IP_HEADER=x-real-ip
```

Use `TRUSTED_CLIENT_IP_HEADER` when your proxy sets one authoritative client-IP header (`X-Real-IP` as above, `CF-Connecting-IP` behind Cloudflare), especially when requests pass through more proxies than you can count. Use `TRUSTED_PROXY_HOPS` when you know the exact number of proxies that append to `X-Forwarded-For`. Only name a header your proxy always sets or overwrites, and keep the app port unreachable except through the proxy; a header passed through from clients lets them spoof their IP.

Quackback accepts MP4 and WebM feedback videos up to 100 MB. If another proxy,
load balancer, or hosting platform sits in front of Quackback, set its request
body limit above 100 MB as well. Image uploads remain limited to 5 MB.

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

## Scaling Out

For deployments with higher load or stricter uptime requirements, run multiple instances:

| Role     | Purpose                                  | Replicas | Notes                                    |
| -------- | ---------------------------------------- | -------- | ---------------------------------------- |
| `all`    | HTTP, background workers, and sweepers   | 1        | Default; suitable for single-node setups |
| `web`    | HTTP only, enqueues but does not consume | 1+       | Safe to scale horizontally               |
| `worker` | Background workers and sweepers          | 1+       | Required for background jobs to run      |

All replicas must share the same PostgreSQL and S3-compatible storage.

Sticky sessions are not required. Realtime features use PostgreSQL `LISTEN`/`NOTIFY`.

Run at least one `worker` replica (or use `all`) at all times, or background jobs like email polling, workflow timers, and analytics refresh will not execute. Multiple worker replicas are safe; jobs are processed exactly once via the shared queue tables in PostgreSQL.

With Amazon SES, each replica paces its own sends (`EMAIL_SES_MAX_SEND_RATE`, default 10 per second), but the sending quota belongs to the AWS account. With several replicas sending, set `EMAIL_SES_MAX_SEND_RATE` on each to roughly the account quota divided by the number of replicas.

### Docker Compose Example

The datastores (Postgres, Silo) are the same as in `docker-compose.prod.yml`. The app splits into a scaled `web` service and a `worker` service running the same image. Web replicas cannot each publish port 3000 on the host, so run a reverse proxy or load balancer (see [Reverse Proxy](#reverse-proxy)) in front of the `web` service and let Compose's internal DNS balance across replicas.

```yaml
services:
  # postgres, minio, minio-init: same as docker-compose.prod.yml (minio runs Silo)

  web:
    image: ghcr.io/quackbackio/quackback:latest
    environment:
      QUACKBACK_ROLE: web
      SKIP_MIGRATIONS: 'true'
      DATABASE_URL: postgresql://postgres:password@postgres:5432/quackback
      SECRET_KEY: ${SECRET_KEY}
      BASE_URL: ${BASE_URL}
      # plus your S3_* and email settings, same as docker-compose.prod.yml
    restart: unless-stopped
    depends_on:
      - postgres
      - minio
    deploy:
      replicas: 3

  worker:
    image: ghcr.io/quackbackio/quackback:latest
    environment:
      QUACKBACK_ROLE: worker
      SKIP_MIGRATIONS: 'true'
      DATABASE_URL: postgresql://postgres:password@postgres:5432/quackback
      SECRET_KEY: ${SECRET_KEY}
      BASE_URL: ${BASE_URL}
      # plus your S3_* and email settings, same as docker-compose.prod.yml
    restart: unless-stopped
    depends_on:
      - postgres
      - minio
    deploy:
      replicas: 1

# volumes: same as docker-compose.prod.yml
```

### Database Migrations at Scale

With a single replica, migrations run automatically on startup. With multiple replicas, set `SKIP_MIGRATIONS=true` on every container (as above) so replicas do not race each other, and run migrations as a separate step before rolling out a new version:

```bash
# Run migrations as a one-off container on the same network
docker run --rm \
  --network <your-compose-network> \
  -e DATABASE_URL="postgresql://postgres:password@postgres:5432/quackback" \
  --entrypoint bun \
  ghcr.io/quackbackio/quackback:latest \
  /app/migrate.mjs

# Then roll out the new image to web and worker replicas
```

---

## Upgrading

### Docker Compose

For the first upgrade from upstream MinIO to Silo, complete the [storage migration steps](#migrating-the-bundled-minio-to-silo) before pulling new source or restarting the stack.

```bash
# 1. Back up your database first
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%Y%m%d).dump

# 2. Pull the latest source + image (bump QUACKBACK_TAG in .env to pin a version)
git pull
docker compose -f docker-compose.prod.yml pull

# 3. Restart: migrations run automatically on startup
docker compose -f docker-compose.prod.yml up -d
```

#### Upgrading from 0.13

There is no rolling upgrade and no downgrade: new migrations are not reversible, so rollback means restoring your backup. Nothing below starts the new stack until step 5, so finish steps 1 to 4 first.

1. **Stop the old stack and back up.** With your existing 0.13 files still in place, stop the app so nothing writes. Do not use `-v`; the volumes must stay:

   ```bash
   docker compose -f docker-compose.prod.yml stop app
   ```

   Then take a Postgres dump and an offline snapshot of object storage by following [Migrating the bundled MinIO to Silo](#migrating-the-bundled-minio-to-silo) (it also covers the MinIO to Silo change). When both are saved, run `docker compose -f docker-compose.prod.yml down` (still without `-v`). Never run the old and new versions against the same database.

2. **Update the files.** Pull the new source with `git pull` (or download the new `docker-compose.prod.yml`, `.env.prod.example` and the `docker/postgres/` directory), set `QUACKBACK_TAG` in `.env`, and make these `.env` changes. Do this whole step before step 5: some of these settings are checked only after the migrations have run.
   - If your `.env` has a `REDIS_URL` line, delete it. Redis and Dragonfly are no longer used. The 0.13 compose file set it for you, so most installs have none.
   - If you set `MINIO_IMAGE_TAG` or `MC_IMAGE_TAG`, remove them.
   - Set `SECRET_KEY` to the value your 0.13 instance used. The compose file refuses to start without it.
   - Set `TRUSTED_PROXY_HOPS`. Behind nginx, Caddy, Traefik or a Cloudflare tunnel, set it to `1` (`2` for a CDN plus a proxy). Left at `0` behind a proxy, every client shares the proxy's IP and one rate-limit bucket, and the app logs a warning. Keep `0` if clients connect directly. If your proxy sets a single client-IP header such as `X-Real-IP`, you can set `TRUSTED_CLIENT_IP_HEADER` instead. See [Reverse Proxy](#reverse-proxy).
   - Keep exactly one email sending provider: `EMAIL_SMTP_HOST`, the `EMAIL_SES_*` keys or `EMAIL_RESEND_API_KEY`. With more than one set, the app will not start; it stops after the migrations have run, so check this now. If a Resend key is there only to receive inbound mail while SMTP or SES sends, add `EMAIL_INBOUND_PROVIDER=resend`.

3. **Check your database.** `DATABASE_URL` must be a direct or session-mode connection, not a transaction pooler (for example a pooler on port 6543), because realtime uses `LISTEN`/`NOTIFY`. Use PostgreSQL 14 or newer with pgvector 0.5 or newer and the `pg_trgm` extension.

4. **Pull the new image.**

   ```bash
   docker compose -f docker-compose.prod.yml pull
   ```

5. **Start once.** The first start runs many migrations and can take several minutes. Do not interrupt it; wait for the app healthcheck to pass.

   ```bash
   docker compose -f docker-compose.prod.yml up -d --remove-orphans
   ```

6. **Remove the unused Dragonfly volume** once the app is healthy:

   ```bash
   docker volume ls | grep dragonfly   # the project name defaults to the directory name
   docker volume rm <project>_dragonfly_data
   ```

#### Migrating the bundled MinIO to Silo

The bundled storage server is now PGSTY Silo. The `minio` service name, `minio_data` volume, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, and S3 endpoint stay the same. Existing `MINIO_IMAGE_TAG` and `MC_IMAGE_TAG` values are ignored because upstream MinIO tags do not identify Silo releases. After taking the snapshot below, remove those settings from `.env`. Leave `SILO_IMAGE` and `SILO_CLIENT_IMAGE` unset to use the digest-pinned defaults, or set them to complete Silo server/client image references, including your private registry if needed. An upstream MinIO server image requires its original healthcheck and Compose configuration.

Before pulling the new source, pause application writes and take a database backup and complete, offline storage snapshot. These commands apply to the bundled single-host stack and save all of `/data`, including `.minio.sys` and IAM state. The backup directory is outside the repository:

```bash
umask 077
SILO_MIGRATION_BACKUP="../silo-migration-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$SILO_MIGRATION_BACKUP"
cp .env "$SILO_MIGRATION_BACKUP/environment.env"
cp docker-compose.prod.yml "$SILO_MIGRATION_BACKUP/compose-before.yml"
docker inspect quackback-minio --format '{{.Image}}' > "$SILO_MIGRATION_BACKUP/image-id.txt"
docker image inspect "$(cat "$SILO_MIGRATION_BACKUP/image-id.txt")" \
  --format '{{json .RepoDigests}}' > "$SILO_MIGRATION_BACKUP/image-digests.json"
docker image save "$(cat "$SILO_MIGRATION_BACKUP/image-id.txt")" \
  > "$SILO_MIGRATION_BACKUP/server-image.tar"

# Keep PostgreSQL running; stop writers before backing up both datastores
# (stopping an already-stopped service is harmless).
docker compose -f docker-compose.prod.yml stop app minio
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$SILO_MIGRATION_BACKUP/database.dump"
docker cp quackback-minio:/data/. - > "$SILO_MIGRATION_BACKUP/data.tar"
tar -tf "$SILO_MIGRATION_BACKUP/data.tar" > /dev/null
```

Keep this backup private: it includes credentials and IAM state. Rehearse restoring the archive into a fresh volume with the recorded old image and saved configuration before proceeding. Preserve file ownership and any external encryption keys. Object-format compatibility does not guarantee that old software understands new IAM or bucket metadata; see [Silo migration and recovery guidance](https://silo.pgsty.com/compatibility/migration/#rollback).

After the backup and restore check, continue with the remaining steps of [Upgrading from 0.13](#upgrading-from-013), or the usual pull/start steps above if you are not coming from 0.13. Confirm the `minio` service is healthy and `minio-init` exits successfully, then download an existing attachment and exercise a new upload through Quackback. The production bucket should still deny anonymous direct downloads. Keep the backup and previous image until these checks pass.

If recovery is needed, stop application writes and restore the pre-upgrade snapshot into a fresh volume using the saved configuration and old image. Account for uploads and credential changes made after the snapshot. Avoid an in-place image downgrade or running old and new servers against the same volume. This sequence restores both the database and storage from the backup above; it deletes the current volumes, so only run it when you mean to roll back:

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm <project>_postgres_data <project>_minio_data
cp "$SILO_MIGRATION_BACKUP/compose-before.yml" docker-compose.prod.yml
cp "$SILO_MIGRATION_BACKUP/environment.env" .env
# Pin the release you are returning to. A restored QUACKBACK_TAG=latest would
# start the newer image you already pulled and migrate the database forward again.
sed -i 's/^QUACKBACK_TAG=.*/QUACKBACK_TAG=0.13.2/' .env
docker image load < "$SILO_MIGRATION_BACKUP/server-image.tar"
docker compose -f docker-compose.prod.yml create
docker compose -f docker-compose.prod.yml up -d --wait postgres
# "already exists" errors for the vector and pg_cron extensions are harmless.
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_restore --no-owner -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$SILO_MIGRATION_BACKUP/database.dump"
docker cp - quackback-minio:/data < "$SILO_MIGRATION_BACKUP/data.tar"
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
bun run --filter @quackback/web start
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
- Database preflight failed: the log names the unmet requirement (PostgreSQL version, pgvector, `pg_trgm`, or a missing privilege). See [Database Setup](#database-setup)
- More than one email sending provider configured (see [Email Not Sending](#email-not-sending))
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
-- User needs CREATE, ALTER, DROP permissions (including TEMPORARY)
GRANT ALL PRIVILEGES ON DATABASE quackback TO your_user;
```

If the user cannot create extensions, have a superuser create `vector` and `pg_trgm` in the database (see [Database Setup](#database-setup)).

### Email Not Sending

Check the startup log. With no provider configured, emails are logged instead of sent. With more than one configured (SMTP, Amazon SES and Resend), the app exits at startup with an error naming the variables in conflict: remove all but one.

For Resend, test the API key directly:

```bash
# Test API key
curl -X POST 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer re_xxxxx' \
  -H 'Content-Type: application/json' \
  -d '{"from":"test@yourdomain.com","to":"you@example.com","subject":"Test","text":"Test"}'
```

### Performance Issues

- Use a session-mode connection pooler if you need one (transaction-mode pooling breaks realtime features)
- Increase container memory limits
- Check for slow database queries

---

## One-Click Deployments

### Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/quackback)

Deploys Quackback + PostgreSQL (with pgvector) + S3-compatible storage bucket to Railway. After deploying:

1. **Find your OTP code**: If email is not configured, login codes appear in Railway's deployment logs
2. **Configure email** (recommended): Add SMTP, Amazon SES or Resend credentials (one of them) in the service's environment variables
3. **Custom domain**: Add a custom domain in Railway, then update the `BASE_URL` environment variable to match

File uploads (logos, avatars, changelog images) work out of the box via the included Railway storage bucket.

See [Railway pricing](https://railway.com/pricing) for costs.

---

## Support

- **Documentation**: https://quackback.io/docs
- **GitHub Discussions**: https://github.com/quackbackio/quackback/discussions
- **GitHub Issues**: https://github.com/quackbackio/quackback/issues
