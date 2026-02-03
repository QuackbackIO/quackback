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
git clone https://github.com/quackbackhq/quackback.git
cd quackback

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings (see Environment Variables below)

# Start the application
docker compose up -d

# View logs
docker compose logs -f
```

Open http://localhost:3000 to access Quackback.

### Using Docker Run

```bash
docker run -d \
  --name quackback \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/quackback" \
  -e BETTER_AUTH_SECRET="your-secret-key-at-least-32-chars" \
  -e BASE_URL="https://your-domain.com" \
  ghcr.io/quackbackhq/quackback:latest
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
docker pull ghcr.io/quackbackhq/quackback:latest

# Pull specific version
docker pull ghcr.io/quackbackhq/quackback:v1.0.0

# Pull enterprise edition
docker pull ghcr.io/quackbackhq/quackback:latest-enterprise
```

---

## Environment Variables

### Required

| Variable             | Description                     | Example                                           |
| -------------------- | ------------------------------- | ------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string    | `postgresql://user:pass@localhost:5432/quackback` |
| `BETTER_AUTH_SECRET` | Auth encryption key (32+ chars) | `your-very-long-random-secret-key`                |
| `BASE_URL`           | Public URL of your instance     | `https://feedback.yourcompany.com`                |

### Optional

| Variable         | Description             | Default      |
| ---------------- | ----------------------- | ------------ |
| `PORT`           | Server port             | `3000`       |
| `NODE_ENV`       | Environment             | `production` |
| `RESEND_API_KEY` | Email service (Resend)  | -            |
| `EMAIL_FROM`     | From address for emails | -            |

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

---

## Building from Source

### Prerequisites

- **Bun** 1.3.3+
- **PostgreSQL** 17+
- **Node.js** 20+ (for some dev tools)

### Build Steps

```bash
# Clone repository
git clone https://github.com/quackbackhq/quackback.git
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
    image: ghcr.io/quackbackhq/quackback:latest
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
  -e BETTER_AUTH_SECRET="..." \
  -e QUACKBACK_LICENSE_KEY="your-license-key" \
  ghcr.io/quackbackhq/quackback:latest-enterprise
```

### Obtaining a License

Contact sales@quackback.io for enterprise licensing information.

---

## Upgrading

### Docker Compose

```bash
# Pull latest image
docker compose pull

# Restart with new image
docker compose up -d

# Migrations run automatically on startup
```

### Docker Run

```bash
# Stop and remove old container
docker stop quackback
docker rm quackback

# Pull new image
docker pull ghcr.io/quackbackhq/quackback:latest

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

Coming soon:

- Railway
- Render
- DigitalOcean App Platform
- Fly.io

---

## Support

- **Documentation**: https://docs.quackback.io
- **GitHub Issues**: https://github.com/quackbackhq/quackback/issues
- **Discord**: https://discord.gg/quackback
