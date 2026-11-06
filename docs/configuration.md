# Runtime configuration

Quackback validates required runtime configuration before it starts workers or accepts traffic.

| Variable       | Required | Description                                                           |
| -------------- | -------: | --------------------------------------------------------------------- |
| `DATABASE_URL` |      Yes | PostgreSQL connection URL.                                            |
| `SECRET_KEY`   |      Yes | At least 32 characters; generate with `openssl rand -base64 32`.      |
| `BASE_URL`     |      Yes | Absolute public `http` or `https` URL for auth, links, and callbacks. |

Production Compose supplies `DATABASE_URL` from its bundled service. You must set `BASE_URL` and `SECRET_KEY` in `.env`.

| Operational variable       |                Default | Description                                                                                                   |
| -------------------------- | ---------------------: | ------------------------------------------------------------------------------------------------------------- |
| `QUACKBACK_ROLE`           |                  `all` | `web`, `worker`, or `all`; split roles when scaling replicas.                                                 |
| `DB_POOL_MAX`              | `10` web / `20` worker | Maximum PostgreSQL connections per process. Keep the replica total below the server budget.                   |
| `DB_IDLE_TIMEOUT`          |                   `20` | Seconds before an idle database connection is closed.                                                         |
| `TRUSTED_PROXY_HOPS`       |                    `0` | Proxy hops permitted to supply client-IP headers. Keep `0` when directly exposed.                             |
| `TRUSTED_CLIENT_IP_HEADER` |                  unset | Header your proxy sets to the client IP, e.g. `X-Real-IP`. Wins over `TRUSTED_PROXY_HOPS`.                    |
| `CHAT_TRANSPORT_MODE`      |                 `live` | Set `poll` only behind proxies that buffer SSE.                                                               |
| `SETUP_OWNER_EMAIL`        |                  unset | Hands an unfinished setup to this address. See [Recovering setup](#recovering-setup).                         |
| `SETUP_TOKEN`              |                  unset | Lets you create the first admin over HTTP. See [Setting up without a browser](#setting-up-without-a-browser). |

With `TRUSTED_PROXY_HOPS=0` (the default), rate limiting and IP-based checks never trust client-supplied headers; they use the actual TCP peer address instead, so distinct clients still get distinct buckets even directly exposed. That resolution depends on the platform reporting the socket peer, which the production build (`bun run start`) always has; a dev runtime that doesn't expose it falls back to a single shared bucket rather than trusting a spoofable header. When you do run behind reverse proxies, set this to the number of hops so client IP is read from the correct `X-Forwarded-For` position instead.

If your proxy sets one authoritative client-IP header, such as nginx with `proxy_set_header X-Real-IP $remote_addr;` or Cloudflare's `CF-Connecting-IP`, you can set `TRUSTED_CLIENT_IP_HEADER` to that header's name instead of counting hops. This is the better choice when requests pass through several proxies whose number you don't control. The header is used only when it holds exactly one valid IP address; otherwise the app falls back to `TRUSTED_PROXY_HOPS` and logs a warning at most once a minute. Only set it when your proxy always sets or overwrites the header and the app port is not reachable directly, otherwise any client can spoof its IP. `X-Forwarded-For` is refused here; use `TRUSTED_PROXY_HOPS` for it.

Use `/api/health/live` for process liveness and `/api/health/ready` for traffic readiness. Readiness checks PostgreSQL, the exact bundled migration ledger, and whether a worker-role process is actually running the job worker.

For optional email, storage, AI, authentication, and integration settings, see [`.env.example`](../.env.example).

## Auth cookie isolation

`AUTH_COOKIE_PREFIX` defaults to `better-auth`, preserving existing cookie names.
Use 1–64 ASCII letters, digits, dots, underscores or hyphens.
Set it to a unique value, such as `quackback`, when another application sets
Better Auth cookies on a shared parent domain. For example, a cookie scoped to
`.example.com` can otherwise collide with Quackback's cookie on
`feedback.example.com`: sign-in succeeds, but subsequent requests resolve the
other application's cookie and return to sign-in.

The prefix changes cookie names, not their security attributes or domain.
All replicas serving the same installation must use the same prefix. Restart
after changing it; users need to sign in again, but accounts and passwords are
unchanged. When a custom prefix is set, Quackback only reads that namespace and
does not fall back to `better-auth` cookies.

## Setting up without a browser

On a new install you can skip the setup wizard. Set `SETUP_TOKEN` to a secret of at least 32 characters, or leave it unset and read the one-time token the server prints to its log on first boot (a line starting `First-run setup token`). Then send it as a bearer token:

```bash
curl -X POST https://feedback.example.com/api/v1/setup \
  -H "Authorization: Bearer $SETUP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workspaceName":"Acme","adminEmail":"you@example.com","adminName":"You"}'
```

The response creates the workspace and its first admin, and includes that admin's first API key. It is shown once, so store it. The admin has no password; they can sign in later with an emailed link or code once email is configured. The endpoint exists only while the install has no admin. After that it answers `404` and the token opens nothing, so you can remove `SETUP_TOKEN`. If `adminEmail` already has an account, it is promoted only when its address is verified (otherwise `409`), and its sessions are ended. It is rate limited, every attempt is logged, and setup and refused attempts are written to the audit log.

## Signing in headless clients

MCP and command-line clients that have no browser can sign in with the OAuth device authorization grant (RFC 8628). The authorization server metadata at `/.well-known/oauth-authorization-server/api/auth` lists `device_authorization_endpoint` and the `urn:ietf:params:oauth:grant-type:device_code` grant. The client registers (`/api/auth/oauth2/register`, with that grant in `grant_types`), asks the device endpoint for a code, and shows the person a short code and the link `/device`. The person opens the link on any device, signs in, checks the client's name and the code, and approves. They can narrow what is granted but never widen it past what the client asked for. The client polls `/api/auth/oauth2/token` until it receives its tokens. Codes expire after ten minutes and work once.

## Recovering setup

The first account created on a new install owns its setup until setup is finished, and nobody else can create an account before then. If that account belongs to someone else, such as a smoke test or a stray visitor, or you can't sign in to it and have no mail configured to reset its password, set `SETUP_OWNER_EMAIL` to the address that should set the install up and restart. Setup then belongs to the account at that address, and that address can create its account if it has none. Every other address still can't create one until setup is finished. Until that account exists, whoever signs up with the address gets it, as on a brand-new install, so create it right away. The variable has no effect once setup is finished.

## Database sizing and audit indexes

Budget connections across every replica: `web replicas × web DB_POOL_MAX + worker replicas × worker DB_POOL_MAX` must remain below PostgreSQL's connection limit with headroom for migrations and operators. Split-role defaults are intentionally smaller than the combined-role default.

Migrations create large search indexes with `CREATE INDEX CONCURRENTLY` after the transactional Drizzle ledger completes. This includes cosine HNSW indexes for every production embedding column, trigram inbox search indexes, and the partial page-view principal index. If a concurrent build is interrupted, rerun `bun run db:migrate`; every statement is idempotent. To roll one back without blocking writes, use `DROP INDEX CONCURRENTLY <index_name>` and rerun migrations when ready to rebuild it.

Validate representative workspaces with `EXPLAIN (ANALYZE, BUFFERS)`: nearest-neighbour queries should order by the bare cosine-distance operator ascending and select an HNSW index scan. Tune session-local `hnsw.ef_search` only after measuring recall against an exact scan; increasing it improves recall at the cost of latency.

## Integration gateway and Slack assistant

Cloud fleets can set `INTEGRATION_OAUTH_GATEWAY_URL=https://app.quackback.io` to use a single OAuth callback origin for shared integration apps. Leave it unset for self-hosted installations. `INTEGRATION_GATEWAY_FORWARD_SECRET` authenticates app-level hooks forwarded by the control plane and is required for these hooks in pooled tenancy. Configure it on both fleet web and worker processes.

On Cloud, set `QUACKBACK_JOB_WORKER_URL` on the **web** service to the worker's private origin (for example `http://${{worker.RAILWAY_PRIVATE_DOMAIN}}:3000`) so Slack and other on-demand jobs start by id instead of waiting for the worker poll. The publisher also requires `QUACKBACK_FLEET_INTERNAL_TOKEN` on web; without both it stays idle and the poll is the floor. Point the URL at the worker, not a web replica: a process that is not running workers returns 503 so the publisher retries. Leave the URL unset to keep poll-only behaviour. Self-host `QUACKBACK_ROLE=all` does not need the URL: after-commit claims in-process.

For single-tenancy deployments with `PLATFORM_CREDENTIALS_SOURCE=env`, complete credentials for an individual provider are managed from environment variables; other providers fall back to database credentials. Slack uses `INTEGRATION_SLACK_CLIENT_ID`, `INTEGRATION_SLACK_CLIENT_SECRET`, and `INTEGRATION_SLACK_SIGNING_SECRET`. Existing tenant-registered resource webhooks retain their current routes and secrets.

See [Slack setup](./integrations/slack-app.md) and [Cloud rollout gates](./integrations/integration-gateway-rollout.md).

Cloud application settings (AI, email, shared OAuth apps) are ordinary Railway environment variables on the CP and fleet services. Self-hosted instances use `.env` / `PLATFORM_CREDENTIALS_SOURCE` as before.
