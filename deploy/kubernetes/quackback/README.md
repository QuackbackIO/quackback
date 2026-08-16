# Quackback Helm Chart

Deploy Quackback on Kubernetes with a single, self-contained chart: the app plus
bundled PostgreSQL, Dragonfly (Redis-compatible queue store), and MinIO
(S3-compatible object storage) — the same stack `docker-compose.prod.yml`
bundles for single-host self-hosting, adapted for a cluster.

## Table of Contents

- [Quick Start](#quick-start)
- [Migrations](#migrations)
- [Configuration](#configuration)
- [Bundled vs. External Datastores](#bundled-vs-external-datastores)
- [Ingress](#ingress)
- [Scheduled Jobs](#scheduled-jobs)
- [Upgrading](#upgrading)
- [Uninstalling](#uninstalling)

## Quick Start

```bash
helm install quackback ./deploy/kubernetes/quackback \
  --namespace quackback --create-namespace \
  --set secretKey="$(openssl rand -base64 32)" \
  --set baseUrl=https://feedback.example.com \
  --set ingress.host=feedback.example.com \
  --set ingress.tls.secretName=feedback-tls
```

This brings up the app plus in-cluster Postgres, Dragonfly, and MinIO —
enough to try Quackback end to end. `ingress.tls.secretName` must name a
TLS secret that already exists in the namespace (e.g. one managed by
cert-manager); the chart doesn't create certificates itself.

Prefer a values file for anything beyond a quick trial — see
[`values.yaml`](values.yaml) for every field, each documented inline.

```bash
helm install quackback ./deploy/kubernetes/quackback \
  --namespace quackback --create-namespace \
  -f my-values.yaml
```

## Migrations

`apps/web/Dockerfile` documents the intended Kubernetes pattern: skip the
container's built-in startup migration and run migrations from a Helm hook
Job instead, so a rolling deploy doesn't pay a DB round-trip on every cold
start. This chart implements that directly:

- `templates/migration-job.yaml` runs `bun /app/migrate.mjs` as a
  `pre-install,pre-upgrade` hook — it must succeed before the release
  proceeds.
- The app Deployment gets `SKIP_MIGRATIONS=true` automatically whenever
  `migrations.enabled` is `true` (the default), so it never re-runs them.

Set `migrations.enabled: false` only if you're managing migrations through
some other out-of-band process; in that case the app's `SKIP_MIGRATIONS` is
left unset and it falls back to running migrations on container start (the
same behavior as `docker run`).

## Configuration

The chart covers the same environment variables as
[`.env.prod.example`](../../../.env.prod.example) — see that file for the
full, authoritative list (including every integration: Slack, Linear, Jira,
Discord, etc.). Commonly-set fields:

| Value                      | Purpose                                                          |
| --------------------------- | ----------------------------------------------------------------- |
| `secretKey`                 | Required. Session signing/encryption key, 32+ chars.               |
| `baseUrl`                   | Required. Public URL — drives auth, emails, OAuth callbacks.       |
| `email.smtp.*` / `email.resendApiKey` | Outbound email. Leave unset to log OTP/invite codes to the pod's console. |
| `oauth.github.*` / `oauth.google.*`   | OAuth sign-in providers. |
| `ai.openaiApiKey` / `ai.openaiBaseUrl` / `ai.chatModel` / `ai.embeddingModel` | AI features (summaries, duplicate detection, extraction) — all four must be set together. |
| `app.extraEnv` / `app.extraEnvFrom`   | Escape hatch for anything else in `.env.prod.example` (integrations, `EMAIL_INBOUND_*`, per-feature `AI_*_MODEL` overrides). |

Values not set fall back to the same defaults the app itself uses (see
`docker-entrypoint.sh` and the app's env validation) — nothing in this chart
invents new defaults beyond what self-hosting already documents.

## Bundled vs. External Datastores

Each datastore defaults to **enabled** (bundled, in-cluster) so the chart is
usable standalone. For production, point at managed services instead:

| Datastore  | Disable with            | Then set                |
| ---------- | ------------------------ | ------------------------ |
| PostgreSQL | `postgres.enabled=false` | `externalDatabaseUrl`   |
| Dragonfly  | `dragonfly.enabled=false`| `externalRedisUrl`      |
| MinIO      | `minio.enabled=false`    | your own `S3_*` vars via `app.extraEnv` |

The bundled PostgreSQL image (`pgvector/pgvector:pg17`) has `pgvector` but
not `pg_cron` — it's meant for evaluation, not production. If you rely on
the scheduled jobs `pg_cron` normally drives (see
[Scheduled Jobs](#scheduled-jobs) below and the self-hosting docs), use an
external Postgres built from [`docker/postgres/Dockerfile`](../../../docker/postgres/Dockerfile)
(which enables both extensions), or handle the SLA tick via this chart's
`slaTickCronJob` instead.

Generated passwords (bundled Postgres/MinIO, when left blank) are stable
across `helm upgrade` — the chart reads back the existing Secret instead of
re-rolling a new one, so upgrades never desync from data already written to
the PVC.

## Ingress

`ingress.className: nginx` (the default) also adds a few
`nginx.ingress.kubernetes.io/*` annotations (body size, redirect, timeouts)
tuned for Quackback's upload endpoints. Any other `ingress.className`
(`traefik`, `caddy`, ...) — both mentioned as supported reverse proxies in
the [self-hosting guide](../self-hosted/README.md#reverse-proxy) — skips
those and applies only `ingress.annotations` verbatim, so you can add
controller-specific annotations (e.g. `cert-manager.io/cluster-issuer`)
without fighting nginx-specific ones.

Set `ingress.enabled: false` to skip the Ingress entirely and expose the
`ClusterIP` Service through your own means (a Gateway API `HTTPRoute`, a
different ingress mechanism, `kubectl port-forward`, ...).

## Scheduled Jobs

The self-hosting guide's [pg_cron section](../self-hosted/README.md#scheduled-jobs-pg_cron)
recommends two jobs: an SLA escalation tick (`POST /api/v1/internal/sla-tick`
every minute) and a webhook-delivery audit purge. This chart adds an
optional CronJob for the first one — the one with an HTTP endpoint to call:

```yaml
internalTaskSecret: "<same value as your pg_cron setup's x-internal-secret, or a fresh one>"
slaTickCronJob:
  enabled: true
```

The webhook-delivery purge is a raw SQL statement, not an HTTP endpoint —
run it via `pg_cron` on whichever Postgres you're using (bundled or
external), per the self-hosting guide.

## Upgrading

```bash
helm upgrade quackback ./deploy/kubernetes/quackback -f my-values.yaml
```

The `pre-upgrade` migration hook runs and must succeed before the app's
Deployment is touched. Back up your database first if you're using the
bundled PostgreSQL — this chart doesn't automate backups (see
[Database Backups](../self-hosted/README.md#database-backups) for the
`pg_dump`/`pg_restore` commands; run them via `kubectl exec` into the
`*-postgres-0` pod).

## Uninstalling

```bash
helm uninstall quackback -n quackback
```

PersistentVolumeClaims (Postgres data, Dragonfly data, MinIO data) are not
deleted automatically — remove them explicitly if you want a clean slate:

```bash
kubectl -n quackback delete pvc -l app.kubernetes.io/instance=quackback
```
