# Runtime configuration

Quackback validates required runtime configuration before it starts workers or accepts traffic.

| Variable       | Required | Description                                                           |
| -------------- | -------: | --------------------------------------------------------------------- |
| `DATABASE_URL` |      Yes | PostgreSQL connection URL.                                            |
| `SECRET_KEY`   |      Yes | At least 32 characters; generate with `openssl rand -base64 32`.      |
| `BASE_URL`     |      Yes | Absolute public `http` or `https` URL for auth, links, and callbacks. |

Production Compose supplies `DATABASE_URL` from its bundled service. You must set `BASE_URL` and `SECRET_KEY` in `.env`.

| Operational variable  |                Default | Description                                                                                 |
| --------------------- | ---------------------: | ------------------------------------------------------------------------------------------- |
| `QUACKBACK_ROLE`      |                  `all` | `web`, `worker`, or `all`; split roles when scaling replicas.                               |
| `DB_POOL_MAX`         | `10` web / `20` worker | Maximum PostgreSQL connections per process. Keep the replica total below the server budget. |
| `DB_IDLE_TIMEOUT`     |                   `20` | Seconds before an idle database connection is closed.                                       |
| `TRUSTED_PROXY_HOPS`  |                    `0` | Proxy hops permitted to supply client-IP headers. Keep `0` when directly exposed.           |
| `CHAT_TRANSPORT_MODE` |                 `live` | Set `poll` only behind proxies that buffer SSE.                                             |

With `TRUSTED_PROXY_HOPS=0` (the default), rate limiting and IP-based checks never trust client-supplied headers; they use the actual TCP peer address instead, so distinct clients still get distinct buckets even directly exposed. That resolution depends on the platform reporting the socket peer, which the production build (`bun run start`) always has; a dev runtime that doesn't expose it falls back to a single shared bucket rather than trusting a spoofable header. When you do run behind reverse proxies, set this to the number of hops so client IP is read from the correct `X-Forwarded-For` position instead.

Use `/api/health/live` for process liveness and `/api/health/ready` for traffic readiness. Readiness checks PostgreSQL, the exact bundled migration ledger, and whether a worker-role process is actually running the job worker.

For optional email, storage, AI, authentication, and integration settings, see [`.env.example`](../.env.example).

## Database sizing and audit indexes

Budget connections across every replica: `web replicas × web DB_POOL_MAX + worker replicas × worker DB_POOL_MAX` must remain below PostgreSQL's connection limit with headroom for migrations and operators. Split-role defaults are intentionally smaller than the combined-role default.

Migrations create large search indexes with `CREATE INDEX CONCURRENTLY` after the transactional Drizzle ledger completes. This includes cosine HNSW indexes for every production embedding column, trigram inbox search indexes, and the partial page-view principal index. If a concurrent build is interrupted, rerun `bun run db:migrate`; every statement is idempotent. To roll one back without blocking writes, use `DROP INDEX CONCURRENTLY <index_name>` and rerun migrations when ready to rebuild it.

Validate representative workspaces with `EXPLAIN (ANALYZE, BUFFERS)`: nearest-neighbour queries should order by the bare cosine-distance operator ascending and select an HNSW index scan. Tune session-local `hnsw.ef_search` only after measuring recall against an exact scan; increasing it improves recall at the cost of latency.

## Integration gateway and Slack assistant

Cloud fleets can set `INTEGRATION_OAUTH_GATEWAY_URL=https://app.quackback.io` to use a single OAuth callback origin for shared integration apps. Leave it unset for self-hosted installations. `INTEGRATION_GATEWAY_FORWARD_SECRET` authenticates app-level hooks forwarded by the control plane and is required for these hooks in pooled tenancy. Configure it on both fleet web and worker processes.

For single-tenancy deployments with `PLATFORM_CREDENTIALS_SOURCE=env`, complete credentials for an individual provider are managed from environment variables; other providers fall back to database credentials. Slack uses `INTEGRATION_SLACK_CLIENT_ID`, `INTEGRATION_SLACK_CLIENT_SECRET`, and `INTEGRATION_SLACK_SIGNING_SECRET`. Existing tenant-registered resource webhooks retain their current routes and secrets.

See [Slack setup](./integrations/slack-app.md) and [Cloud rollout gates](./integrations/integration-gateway-rollout.md).

### Cloud settings management

Manage Cloud application settings in **quackback-cp → Admin → Settings** as one JSON object using environment variable names. This covers AI, email, integrations and other application settings. JSON values override container environment values; missing keys preserve the environment and `null` unsets a variable.

Pooled containers fetch one encrypted-at-rest settings snapshot before their existing entrypoint starts migrations, workers or the server. Settings changes require a container restart. The dedicated `QUACKBACK_CP_SETTINGS_TOKEN` and `QUACKBACK_CONTROL_PLANE_URL` remain container bootstrap variables. Cloud refuses startup when settings cannot be loaded; self-hosted containers make no CP call and retain their existing behavior. See the [rollout runbook](./integrations/integration-gateway-rollout.md).
