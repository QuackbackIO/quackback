# Runtime configuration

Quackback validates required runtime configuration before it starts workers or accepts traffic.

| Variable       | Required | Description                                                           |
| -------------- | -------: | --------------------------------------------------------------------- |
| `DATABASE_URL` |      Yes | PostgreSQL connection URL.                                            |
| `REDIS_URL`    |      Yes | Redis-compatible BullMQ connection URL.                               |
| `SECRET_KEY`   |      Yes | At least 32 characters; generate with `openssl rand -base64 32`.      |
| `BASE_URL`     |      Yes | Absolute public `http` or `https` URL for auth, links, and callbacks. |

Production Compose supplies `DATABASE_URL` and `REDIS_URL` from its bundled services. You must set `BASE_URL` and `SECRET_KEY` in `.env`.

| Operational variable  |                Default | Description                                                                                 |
| --------------------- | ---------------------: | ------------------------------------------------------------------------------------------- |
| `QUACKBACK_ROLE`      |                  `all` | `web`, `worker`, or `all`; split roles when scaling replicas.                               |
| `DB_POOL_MAX`         | `10` web / `20` worker | Maximum PostgreSQL connections per process. Keep the replica total below the server budget. |
| `DB_IDLE_TIMEOUT`     |                   `20` | Seconds before an idle database connection is closed.                                       |
| `TRUSTED_PROXY_HOPS`  |                    `0` | Proxy hops permitted to supply client-IP headers. Keep `0` when directly exposed.           |
| `CHAT_TRANSPORT_MODE` |                 `live` | Set `poll` only behind proxies that buffer SSE.                                             |

With `TRUSTED_PROXY_HOPS=0` (the default), rate limiting and IP-based checks never trust client-supplied headers; they use the actual TCP peer address instead, so distinct clients still get distinct buckets even directly exposed. That resolution depends on the platform reporting the socket peer, which the production build (`bun run start`) always has; a dev runtime that doesn't expose it falls back to a single shared bucket rather than trusting a spoofable header. When you do run behind reverse proxies, set this to the number of hops so client IP is read from the correct `X-Forwarded-For` position instead.

Use `/api/health/live` for process liveness and `/api/health/ready` for traffic readiness. Readiness checks PostgreSQL, Redis, the exact bundled migration ledger, and worker boot failures.

For optional email, storage, AI, authentication, and integration settings, see [`.env.example`](../.env.example).

## Database sizing and audit indexes

Budget connections across every replica: `web replicas × web DB_POOL_MAX + worker replicas × worker DB_POOL_MAX` must remain below PostgreSQL's connection limit with headroom for migrations and operators. Split-role defaults are intentionally smaller than the combined-role default.

Migrations create large search indexes with `CREATE INDEX CONCURRENTLY` after the transactional Drizzle ledger completes. This includes cosine HNSW indexes for every production embedding column, trigram inbox search indexes, and the partial page-view principal index. If a concurrent build is interrupted, rerun `bun run db:migrate`; every statement is idempotent. To roll one back without blocking writes, use `DROP INDEX CONCURRENTLY <index_name>` and rerun migrations when ready to rebuild it.

Validate representative tenants with `EXPLAIN (ANALYZE, BUFFERS)`: nearest-neighbour queries should order by the bare cosine-distance operator ascending and select an HNSW index scan. Tune session-local `hnsw.ef_search` only after measuring recall against an exact scan; increasing it improves recall at the cost of latency.
