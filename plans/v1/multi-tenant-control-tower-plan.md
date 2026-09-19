# Multi-App from One Deployment + Fleet Control Tower — Design Plan

> **Status:** Proposal / planning only. Nothing in this document has been implemented.
> **Scope:** How to run many isolated Quackback "apps" (tenants) from a single deployment
> while giving administrators one SSO login that can **see and manage** feedback, roadmaps,
> support, and changelog **across every app** — without losing the ability to pull upstream
> Quackback releases.

## 1. Decisions locked in

These were chosen explicitly and constrain the rest of the design:

| #   | Decision                     | Value                                                                                               |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Cross-tenant admin depth     | **Tier B** — one screen that _aggregates and acts on_ every app (not just a switcher)               |
| 2   | Admin identity               | **SSO / OIDC** (central IdP)                                                                        |
| 3   | Tenant count (near-term)     | **5–10 apps** → live fan-out reads, no separate reporting store yet                                 |
| 4   | Where the control tower runs | **Same deployment** as the tenant app (additive routes), accepting one small upstreamable core seam |

## 2. Goals and non-goals

### Goals

- Each app is isolated from the **end-user** perspective: its own hostname, portal, branding, boards, roadmap, changelog, support — end users never see another app's data.
- A **single fleet-admin SSO login** can view an **aggregated** inbox / feedback / roadmap / changelog spanning all apps, and **act** on any app (reply to support, change status, move roadmap items, publish changelog) from that unified surface.
- **Upgrade-safety:** pulling new upstream Quackback releases must keep working. Minimize/avoid forking core files; prefer additive companion code, env configuration, documented seams, and upstream PRs.

### Non-goals (for this phase)

- Per-tenant inbound email threading (blocked by a process-wide secret; see §12).
- Per-tenant billing/entitlements (commercial "cloud" layer stays **off**; self-host is entitled to everything).
- Row-level multi-tenancy inside a single database (explicitly rejected; see §14).
- A separate proprietary control-plane _service_ (`quackback-cp`) — not required for core operation.

## 3. Glossary

| Term                               | Meaning                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App / tenant / workspace**       | One customer instance. In Quackback = **one Postgres database** with exactly one `settings` row.                                                                                                     |
| **Pooled tenancy**                 | Upstream mode (`QUACKBACK_TENANCY=pooled`): one process serves many workspaces, chosen per request from the `Host` header.                                                                           |
| **Single tenancy**                 | Default mode (`QUACKBACK_TENANCY=single`): one `DATABASE_URL`, one workspace.                                                                                                                        |
| **Control DB**                     | A Postgres database (`QUACKBACK_CONTROL_DATABASE_URL`) holding the workspace registry the app _reads_.                                                                                               |
| **Control plane (`quackback-cp`)** | The separate, non-public system that in Quackback Cloud _writes_ the registry and provisions tenants. **Not in this repo.** We replace its essential functions with a small, self-owned provisioner. |
| **Control tower**                  | The new fleet-admin console this plan adds — the cross-tenant management surface.                                                                                                                    |
| **Fleet-admin**                    | An operator who logs in via SSO to the control tower and manages all apps. Distinct from per-app end users.                                                                                          |

## 4. Current-state analysis (what the repo already provides)

**Key finding:** Quackback already ships the _runtime/reader_ half of DB-per-tenant multi-tenancy. What is missing is the _writer_ half (provisioning + the registry tables) and any cross-tenant admin surface.

### 4.1 Pooled tenancy runtime (present, in-repo)

Authoritative design doc: `apps/web/src/lib/server/workspaces/TENANCY.md`.

- **Mode switch:** `apps/web/src/lib/server/workspaces/mode.ts` (`isPooledTenancy()`), canonicalized in `apps/web/src/lib/server/config.ts` (`tenancyMode`, `isPooledTenancy`).
- **Host → workspace resolution:** `workspaces/registry.ts` (`resolveWorkspaceByHostname`, `resolveWorkspaceById`, `listActiveWorkspaces`), `workspaces/resolver.ts`, `workspaces/request-scope.ts`, middleware `middleware/workspace-context.ts`. Registered order in `start.ts`: `requestContextMiddleware → workspaceContextMiddleware → csrfMiddleware`.
- **Request scoping:** `workspaces/workspace-context.ts` (`runWithWorkspaceScope`, `getCurrentWorkspace`, `withWorkspaceScopeById`) over `AsyncLocalStorage`. The `db` Proxy (`@/lib/server/db`) resolves a per-request connection; **537 files import `db` unchanged**. In pooled mode, `db` access with no scope throws `WorkspaceScopeMissingError`.
- **Fingerprint / anti-clone:** `workspaces/fingerprint.ts`, `workspaces/physical-identity.ts` verify each pool once against three facts (`settings.id`, control-plane stamp, `pg_database.oid`).
- **Connection pooling:** `workspaces/pool-cache.ts` — LRU keyed by workspace id; eviction is the cost model (`WORKSPACE_POOL_*`).
- **Per-workspace secrets:** `workspaces/workspace-secrets.ts` + vendored crypto derive `SECRET_KEY` and open storage creds per workspace from **one** `QUACKBACK_FLEET_ROOT_KEY` (local HKDF/AEAD — **no external vault needed**).
- **Background work:** `jobs/worker.ts` runs one loop per workspace; sweeps fan out via `withSweepLock` / `fleet.ts` `runFleetPass`; dormancy parking in `workspaces/activity.ts`. Roles in `process-role.ts` / `startup.ts` (`QUACKBACK_ROLE` = `web` | `worker` | `all` | `migrator`).
- **Per-workspace config:** `config.baseUrl` returns the workspace's `routing.baseUrl` when scoped; `auth/trusted-origins.ts` returns the workspace's own hostnames.
- **Fleet migrations:** `apps/web/scripts/fleet-migrator.ts` (+ `fleet/schema-state.ts`) migrates every tenant DB from one command.

### 4.2 The vendored contract (the upgrade-safety anchor)

`workspaces/vendor/*.ts` — `contract.ts`, `secret-ref.ts`, `fleet-secrets.ts`, `workspace-secret-resolution.ts`, `mail-slug-pattern.ts` — are copied **byte-for-byte** from the control plane and guarded by:

- `workspaces/__tests__/vendor-parity.test.ts` — committed SHA-256 digests (always run) + a byte comparison against a control-plane checkout when present at `QUACKBACK_CP_TENANCY_DIR` (**skips gracefully when absent**, so it will not fail our CI).
- `workspaces/__tests__/vendor-digest.test.ts` — duplicate digest guard.

Because these modules are in-tree and pinned, **any provisioner we build that imports them stays automatically in lockstep with whatever upstream version we have checked out.**

### 4.3 Commercial "cloud" gating (orthogonal, default-off)

- `domains/settings/cloud/*` — `DISABLED_CLOUD_CONFIG`, `getCloudConfig()`, `isEntitled()` (returns `true` when cloud disabled), `tier-limits.service.ts` `OSS_TIER_LIMITS` (unlimited).
- `settings.cloud` JSON column (`packages/db/src/schema/auth.ts`) is `NULL` on self-host ⇒ every feature entitled, no upsell, no outbound control-plane calls.
- **No entitlement or tier limit caps the number of apps/workspaces.** The only multi-workspace cap (`FREE_WORKSPACE_OWNER_CAP`) is enforced control-plane-side in Quackback Cloud and is irrelevant to self-host.
- **We keep this layer off** (`QUACKBACK_CONTROL_PLANE_URL` unset).

### 4.4 Existing "owner workspaces" is only a switcher (and CP-gated)

`functions/owner-workspaces.ts` (`listOwnerWorkspacesFn`, `openOwnerWorkspaceFn`) merely lists workspaces and returns a URL to open **one at a time**, gated on `cloud.enabled` and requiring the proprietary control plane. **It is not an aggregated console and is unavailable to self-host.** The control tower in this plan is net-new.

### 4.5 What is missing in-repo (must be built or configured)

- **Control-DB schema:** `cp_workspace_registry`, `cp_workspace_hostnames`, `cp_workspace_activity`, `cp_workspace_schema_state` — **no DDL exists in this repo** (owned by `quackback-cp`).
- **Provisioner:** create tenant DB → migrate → create/stamp `settings` (fingerprint stamp `settings.cloud_workspace_key`, secret canary `settings.cloud_secret_canary`, catalog OID) → insert registry + hostname rows.
- **Any cross-tenant admin surface** and **any fleet-admin identity realm.**

## 5. Requirements traceability

| Requirement                      | Mechanism                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End users see only their app     | Native pooled isolation: Host → one tenant DB; cross-tenant access is a refusal by design.                                                                |
| One SSO login for admins         | New fleet-admin auth realm bound to the control DB, wired to the org IdP (OIDC/SSO).                                                                      |
| See info about every app         | Cross-tenant read fan-out via `listActiveWorkspaces()` + `withWorkspaceScopeById()` calling existing `domains/*` read services; merge + tag by app.       |
| Manage every app from one screen | Scoped writes via `withWorkspaceScopeById()` into the target tenant, calling existing `domains/*` mutation services as a real per-tenant admin principal. |
| Upgrade-safe                     | Additive artifacts + reuse of documented seams + vendored-contract tracking; the single core seam is contributed upstream.                                |

## 6. Architecture overview

```mermaid
flowchart TB
  subgraph clients [End users]
    U1[acme.example.com]
    U2[beta.example.com]
    U3[gamma.example.com]
  end
  subgraph admins [Fleet admins]
    A[admin.example.com\nSSO login]
  end

  subgraph deploy [ONE deployment: QUACKBACK_TENANCY=pooled]
    MW[workspace-context middleware\nHost -> tenant]
    subgraph tower [Control Tower routes /fleet/*  (additive)]
      FAUTH[Fleet-admin auth realm\nBetter Auth on Control DB + OIDC]
      ENGINE[Cross-tenant engine\nlistActiveWorkspaces + withWorkspaceScopeById]
      UI[Unified inbox / feedback / roadmap / dashboard]
    end
  end

  subgraph data [Postgres cluster]
    CDB[(Control DB\ncp_workspace_registry\ncp_workspace_hostnames\ncp_workspace_activity\ncp_workspace_schema_state\ncp_fleet_admins\ncp_fleet_audit)]
    D1[(acme DB)]
    D2[(beta DB)]
    D3[(gamma DB)]
  end

  U1 --> MW --> D1
  U2 --> MW --> D2
  U3 --> MW --> D3
  A --> FAUTH --> CDB
  ENGINE --> CDB
  ENGINE -->|withWorkspaceScopeById| D1 & D2 & D3
  UI --> ENGINE
```

Two planes over the same databases:

- **Tenant plane** (existing): `Host` → tenant DB, strict isolation.
- **Fleet plane** (new): SSO admin → control DB for identity + registry → fan-out into every tenant DB through the existing scope seam.

## 7. Component design

### 7.1 Control-DB schema (new, additive package — e.g. `packages/fleet-control/`)

**Registry tables** — column shapes are derived precisely from the reader `workspaces/registry.ts` (`SELECT_COLUMNS`, `RegistryRow`, `interpretRow`, `toRecord`) so the vendored contract validates them.

`cp_workspace_registry` (one row per app):

| Column                   | Notes                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `workspace_key` (PK)     | Stable workspace id used everywhere.                                                        |
| `contract_version`       | Must match vendored contract version.                                                       |
| `state`                  | `active` \| `suspended` \| `deleting` (+ unknown ⇒ refused).                                |
| `state_reason`           | Nullable operator reason.                                                                   |
| `primary_hostname`       | Canonical host.                                                                             |
| `base_url`               | Per-workspace absolute origin (no wildcard).                                                |
| `db_pooled_url`          | Transaction-mode DSN (request pools).                                                       |
| `db_direct_url`          | Session-mode DSN (LISTEN, advisory locks, `CREATE INDEX CONCURRENTLY`).                     |
| `db_name`                | Catalog name (anti-clone).                                                                  |
| `db_role`                | DB role for credential rotation.                                                            |
| `db_credential_ref`      | `env://` \| `sealed+aead://…/db`.                                                           |
| `app_secrets_ref`        | `derived+hkdf://v<gen>/<workspace>/app-secrets` \| `env://`.                                |
| `workspace_id`           | Expected `settings.id` (fingerprint).                                                       |
| `fingerprint_stamped_at` | Stamp timestamp.                                                                            |
| `storage` (JSON)         | `{ bucket, endpoint, region, credentialRef? }`; omit `credentialRef` ⇒ shared fleet bucket. |
| `email_from`             | Outbound From for the app.                                                                  |
| `mail_slug`              | Slug in inbound plus-addresses.                                                             |
| `ai_enabled`             | Feature flag.                                                                               |
| `revision`               | Bumped on update; invalidates caches within TTL.                                            |
| `pg_database_oid`        | Catalog OID (anti-clone; nullable ⇒ check skipped).                                         |
| `pg_cluster_id`          | Cluster identity (anti-clone).                                                              |

`cp_workspace_hostnames` (hostname is globally unique):

| Column                 | Notes                                             |
| ---------------------- | ------------------------------------------------- |
| `hostname` (PK)        | Normalized (lowercase, no port/trailing dot).     |
| `workspace_key` (FK)   | Owning app.                                       |
| `kind`                 | e.g. `primary` \| `alias` \| `platform_redirect`. |
| `redirect_to_hostname` | Destination when `kind = platform_redirect`.      |

`cp_workspace_activity`: `workspace_key` (PK/FK), `last_active_at` — written by `workspaces/activity.ts`, read for dormancy in `listActiveWorkspaces()`.

`cp_workspace_schema_state`: migration intent/lease per workspace — shape derived from `apps/web/src/lib/server/fleet/schema-state.ts` (used by `fleet-migrator.ts`). Reverse-engineer exact columns from that module during Phase 1.

**Fleet-admin tables** (new for the control tower):

`cp_fleet_admins`:

| Column                     | Notes                           |
| -------------------------- | ------------------------------- |
| `id` (PK)                  |                                 |
| `sso_subject`              | OIDC `sub`.                     |
| `email`                    | From IdP.                       |
| `role`                     | `viewer` \| `agent` \| `owner`. |
| `status`                   | `active` \| `disabled`.         |
| `created_at`, `updated_at` |                                 |

`cp_fleet_audit` (every cross-tenant action):

| Column                              | Notes                                                            |
| ----------------------------------- | ---------------------------------------------------------------- |
| `id` (PK)                           |                                                                  |
| `actor_sso_subject` / `actor_email` | Who.                                                             |
| `workspace_key`                     | Which app the action targeted.                                   |
| `action`                            | e.g. `conversation.reply`, `post.status_change`, `roadmap.move`. |
| `target_ref`                        | Affected entity id.                                              |
| `metadata` (JSON)                   | Before/after or payload summary.                                 |
| `created_at`                        |                                                                  |

**Contract shape produced** (from `toRecord()` → `validateWorkspaceRecord()`):
`{ contractVersion, workspaceKey, revision, routing{primaryHostname, hostnames[], baseUrl}, database{pooledUrl, directUrl, name, role, credentialRef}, fingerprint{expectedWorkspaceKey, expectedSelfReportedWorkspaceId, stampedAt}, secrets{appSecretsRef}, storage, email{from, mailSlug}, features{aiEnabled} }`.

### 7.2 Provisioner CLI (new, additive)

A single command (e.g. `packages/fleet-control/provision.ts` or `apps/web/scripts/provision-workspace.ts`) that stands up one app end-to-end. It **imports the app's own vendored modules** so it never drifts from the contract:

Steps:

1. **Create the tenant database** in the shared cluster (`CREATE DATABASE`).
2. **Migrate** it by shelling to the existing migrator: `DATABASE_URL=<tenant> bun run db:migrate` (runs `packages/db/src/migrate.ts` → extensions, migrations, `seedSystemData`, postconditions). Alternatively use `fleet-migrator.ts` once registered.
3. **Create/stamp `settings`** (or let onboarding create it, then stamp):
   - Compute `workspace_id` = `settings.id`.
   - Write the control-plane **fingerprint stamp** to `settings.cloud_workspace_key` (workspace migration `0251`).
   - Seal the **secret canary** into `settings.cloud_secret_canary` (workspace migration `0252`) using vendored `fleet-secrets.ts` (`deriveWorkspaceSecret` + AEAD seal), keyed by `QUACKBACK_FLEET_ROOT_KEY`.
   - Record `pg_database_oid` and cluster id.
4. **Insert registry + hostname rows** with:
   - `app_secrets_ref = derived+hkdf://v1/<workspace>/app-secrets`
   - `db_credential_ref = env://…` (or `sealed+aead://…/db`)
   - `storage` = shared bucket (omit `credentialRef`) or per-app bucket + `sealed+aead://…/storage`.
5. **Seed the SSO admin(s)** as an admin `principal` in the new tenant DB (see §7.4) so cross-tenant writes have a real actor.
6. Provide **`suspend` / `deprovision`** paths (flip registry `state`; teardown DB).

Also useful and already in-repo (read-only): `apps/web/scripts/verify-workspace-secrets.ts` to validate refs after provisioning.

### 7.3 Secrets model (reuse vendored crypto)

- **`QUACKBACK_FLEET_ROOT_KEY`** (≥32 chars) is the single root. Per-workspace `SECRET_KEY` is derived via HKDF (`derived+hkdf://v<gen>/<workspace>/app-secrets`) — no storage, no vault.
- **DB password**: `env://<VAR>` (simplest) or `sealed+aead://v<gen>/<workspace>/db/<blob>` (blob rides in the ref, opened under a key derived from the root).
- **Storage creds**: omit `credentialRef` for a shared fleet bucket (isolation via `w/<settings.id>/` key prefix, already implemented in `storage/namespace.ts`), or `sealed+aead://…/storage` for per-app scoped tokens.
- **Canary** proves the derived key actually opens the workspace's data before serving (fail-closed). **Blast radius:** one root opens all apps — documented trade-off; the `v<gen>` generation field makes rotation a migration, not a flag day.
- Injection seam if external custody is ever needed: `setWorkspaceSecretsResolver()` in `workspace-secrets.ts` (the built-in local resolver is the default and needs no client).

### 7.4 Fleet-admin identity (SSO)

- **Separate realm:** a dedicated Better Auth instance bound to the **control DB** (not any tenant DB), configured with the org's OIDC/SSO provider; cookie scoped to the admin host. Fleet-admins are **not** per-tenant end users.
- **Authorization:** map OIDC group/domain claims → `cp_fleet_admins.role` (`viewer` read-only, `agent` can act on support/feedback, `owner` full incl. provisioning). Enforced on every control-tower route and every cross-tenant write.
- **Acting identity inside a tenant:** the same SSO identity is provisioned as an **admin `principal` in each tenant DB** (auto-provision on first login via OIDC + signup policy, or seeded by the provisioner in step 7.2.5). This makes cross-tenant writes execute under real per-tenant RBAC with correct authorship, and lets an admin "open" a single app directly if desired.
- Relevant existing code: `auth/index.ts`, `auth/trusted-origins.ts`, `auth/signup-policy.ts` (`guardBetterAuthUserCreation`), `domains/principals/bootstrap-admin.ts` (`isOpenToBootstrapClaim`), `workspaces/provenance.ts` (`isProvisionedWorkspace`).

### 7.5 Admin-surface workspace-resolution bypass (the one core seam)

The pooled middleware maps every `Host` to a tenant; the admin surface must **not** be resolved as a tenant. Options, in order of preference:

1. **Env-configurable workspace-exempt prefix** (e.g. `/fleet/*`, `/api/fleet/*`) added to the `FLEET_PATHS` bypass in `workspaces/request-scope.ts`, and **contributed upstream** as a general feature. Smallest change; keeps us on trunk.
2. Dedicated admin host recognized as fleet (host allowlist) — same bypass mechanism keyed by host.
3. **Fallback (0 core edits):** run the control tower as a **separate process** sharing the repo/image — abandons "same deployment" but is purely additive. Use only if upstreaming (1) is undesirable.

### 7.6 Cross-tenant engine (fan-out + scoped writes)

Reuse two existing seams; **do not duplicate business logic**:

- `listActiveWorkspaces()` (`workspaces/registry.ts`) → tenants + DSNs.
- `withWorkspaceScopeById(workspaceKey, origin, fn)` (`workspaces/workspace-context.ts`) → opens a real workspace scope so the `db` proxy resolves to that tenant.

**Critical boundary:** call the **`domains/*` service layer** (actor-parameterized, e.g. `createPost(input, author)`, conversation reply services), **not** the `functions/*` RPC layer, because `functions/*` call `requireAuth()` against a request session that does not exist during fan-out.

Reads (aggregate) — bounded concurrency (limit ~5), per-tenant timeout, partial results:

```
tenants = listActiveWorkspaces()
results = await mapWithLimit(tenants, 5, t =>
  withTimeout(withWorkspaceScopeById(t.workspaceKey, t.routing.baseUrl,
    () => listConversations(filter)),         // existing domain read
  perTenantTimeoutMs)
  .then(rows => rows.map(r => ({ ...r, appKey: t.workspaceKey, appName: t.routing.primaryHostname })))
  .catch(() => ({ degraded: t.workspaceKey }))
)
merge + sort + annotate degraded apps
```

Writes (act on one app) — scoped, as a real principal, audited:

```
withWorkspaceScopeById(target.workspaceKey, target.routing.baseUrl, () =>
  replyToConversation(input, fleetAdminPrincipalInThatTenant))   // existing domain mutation
insert cp_fleet_audit(actor, target.workspaceKey, 'conversation.reply', ...)
```

### 7.7 Unified surfaces (mapped to existing domains)

| Surface           | Existing domain          | Aggregate read                                                          | Scoped action                                     |
| ----------------- | ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------- |
| **Support inbox** | `domains/conversation/*` | All threads across apps, tagged by app; filters (app, status, assignee) | reply / assign / close / snooze into the app's DB |
| **Feedback**      | posts / boards           | Cross-app posts with votes, status, board                               | status change / merge / comment / delete-restore  |
| **Roadmap**       | roadmap items/columns    | Aggregated Planned / In-Progress / Complete                             | move item / edit / link post                      |
| **Changelog**     | changelog                | Cross-app entries + schedule                                            | publish / edit / schedule                         |
| **Dashboard**     | rollups                  | Per-app counts, activity, degraded indicators                           | drill-in to any app                               |

Each surface: aggregated list (fan-out read) + drill-in detail (single-tenant scope) + action (single-tenant scoped mutation) + audit.

## 8. Routing, hostnames, TLS, sessions

- **Tenants:** `*.example.com` subdomains (wildcard DNS + wildcard TLS cert) or custom domains per app. Plain DNS pointed at the deployment is sufficient — the Cloudflare-for-SaaS edge (`QUACKBACK_SAAS_*`) is **optional** and only needed for signed customer-host routing.
- **Admin surface:** `admin.example.com` (or `/fleet/*`), workspace-exempt (§7.5), its own TLS.
- **Cookies/sessions:** tenant sessions are per-host (per workspace `baseUrl`); the fleet-admin session is a separate cookie on the admin host. No cross-contamination.
- **`BASE_URL`:** per-workspace when scoped; the process-level `BASE_URL` must be a real origin (wildcard refused). Note: `TRUSTED_ORIGINS` becomes the workspace's own hostnames under pooling.

## 9. Process roles & deployment

- Run at least one **`QUACKBACK_ROLE=worker`** (or `all`) replica so each tenant's `job_queue` drains; web replicas are producer-only (`QUACKBACK_ROLE=web`).
- Unset role defaults to `all` (fine for a small fleet on one node).
- **Migrations across the fleet:** `QUACKBACK_ROLE=migrator QUACKBACK_TENANCY=pooled QUACKBACK_CONTROL_DATABASE_URL=… bun run apps/web/scripts/fleet-migrator.ts run` (or `--workspace <id>`), run on deploy of a new Quackback version.
- **Dormancy:** `WORKSPACE_DORMANT_AFTER_HOURS` (default 168) parks idle tenants; the control tower's fan-out counts as activity only per `isActivitySignal` rules — health/anonymous reads don't wake tenants.

## 10. Configuration reference (pooled + fleet)

| Variable                                                              | Role                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `QUACKBACK_TENANCY=pooled`                                            | Enables pooled multi-tenant behavior.                                            |
| `QUACKBACK_CONTROL_DATABASE_URL`                                      | Control DB (registry). **Required** in pooled.                                   |
| `DATABASE_URL`                                                        | **Must be UNSET** in pooled (boot refuses it; `db` proxy refuses independently). |
| `QUACKBACK_FLEET_ROOT_KEY`                                            | ≥32 chars; derives per-workspace secrets.                                        |
| `SECRET_KEY`                                                          | Still required for config load; per-workspace key used when scoped.              |
| `WORKSPACE_POOL_MAX` / `_MAX_ENTRIES` / `_IDLE_SECONDS`               | Pool tuning (defaults 3 / 50 / 45).                                              |
| `WORKSPACE_REGISTRY_TTL_MS`                                           | Hostname→record cache TTL (default 30000).                                       |
| `WORKSPACE_DORMANT_AFTER_HOURS`                                       | Idle parking (default 168; 0 disables).                                          |
| `QUACKBACK_ROLE`                                                      | `web` \| `worker` \| `all` \| `migrator`.                                        |
| `BASE_URL`                                                            | Real origin; per-workspace origin comes from the record when scoped.             |
| `QUACKBACK_CONTROL_PLANE_URL`                                         | **Keep UNSET** — billing/entitlements only.                                      |
| `PLATFORM_CREDENTIALS_SOURCE`                                         | Auto-forced to `control-plane` under pooled — see §12 caveat.                    |
| `QUACKBACK_SAAS_RAILWAY_ORIGIN` / `_FALLBACK_ORIGIN` / `_EDGE_SECRET` | Optional Cloudflare-for-SaaS custom-domain edge.                                 |
| OIDC/SSO provider settings                                            | For the fleet-admin realm (control DB).                                          |

## 11. Upgrade-safety strategy (the core constraint)

- **Additive artifacts only** (new files, new package, new routes): control-DB schema, provisioner, fleet-admin auth realm, `/fleet/*` routes, cross-tenant engine, `cp_fleet_admins` / `cp_fleet_audit`.
- **Reuse, don't fork:** `withWorkspaceScopeById`, `listActiveWorkspaces`, `resolveWorkspaceById`, the `domains/*` services, the shared `packages/db` schema, and the vendored contract/crypto.
- **Contract tracking:** the provisioner imports `workspaces/vendor/*` so it moves with the checked-out version; the parity tests skip when no CP checkout is present, so they won't break CI.
- **The single core seam** (workspace-exempt admin prefix, §7.5) is **contributed upstream** as an env-configurable feature — or avoided entirely by running the tower as a separate process.
- **Policy:** never patch core locally; if a core change is unavoidable, upstream it. Keep the fork limited to additive companion code + env + config.
- **Merge hygiene:** pull upstream regularly; run `bun run test` (esp. `workspaces/__tests__/*`, `domains/settings/cloud/__tests__/*`) and the isolation probe after each upgrade.

## 12. Known blockers & caveats

1. **Inbound email is fleet-off initially.** `EMAIL_INBOUND_SIGNING_SECRET` is process-wide; a shared secret would let one app forge Reply-To into another's conversations (`TENANCY.md` §7). Outbound email and in-app support work. Per-tenant inbound is a later upstream contribution.
2. **`PLATFORM_CREDENTIALS_SOURCE` auto-flips to `control-plane` under pooled** (`config.ts`). Validate integration-OAuth behavior; keep gateway-dependent integrations off until confirmed. Core feedback/roadmap/support/changelog are unaffected.
3. **Process-wide config shared across apps** unless extended via the registry: outbound SMTP/SES transport, `OPENAI_API_KEY` / AI models, `config.yaml` watcher (not started under pooled). Acceptable for a single-operator fleet; revisit for per-tenant AI/email billing.
4. **Fleet root key blast radius** (§7.3).
5. **The control tower crosses the isolation boundary** — highest-value component; see §13.
6. **Onboarding of a fresh tenant DB:** after migrate you have schema + system data but no `settings`/admin until either the onboarding wizard runs (`/onboarding`, `functions/onboarding.ts`, `setup-state.ts`, `isOnboardingComplete` in `packages/db/src/types.ts`) or the provisioner seeds it. Decide provisioner-seeds vs. first-SSO-login-claims per app.

## 13. Security & audit

- Control tower is SSO-gated with least-privilege fleet roles (`viewer`/`agent`/`owner`); default read-only, explicit elevation for writes.
- It holds every tenant DSN (via the registry) — treat as the crown-jewel service: network-isolate, restrict who can reach the admin host, MFA at the IdP.
- **Every cross-tenant write is audited** in `cp_fleet_audit` (actor, app, action, target, before/after).
- Per-tenant RBAC still applies because writes act as a real tenant principal.
- Rate-limit and scope bulk cross-tenant operations.

## 14. Alternatives considered & rejected

- **Row-level multi-tenancy in one DB** (`org_id` on every table): rejected — the app is deliberately one `settings` row per DB with fingerprint enforcement (`TENANCY.md` §3, `requireSettings()`); this is a massive core rewrite that permanently breaks upgrades.
- **N independent single-tenant deployments:** upgrade-safe and zero-code but not "one deployment," N× ops, no shared worker/routing, and no path to an aggregated console. Viable only as a stopgap.
- **Building the full `quackback-cp` service:** unnecessary — the app reads the registry DB directly; the HTTP control plane is billing-only, which self-host doesn't need.
- **Aggregated reporting read-model now:** deferred — unnecessary at 5–10 tenants; live fan-out suffices. Add when tenant count reaches dozens+ (stream tenant events into a shared store for dashboards; keep live drill-in against the tenant DB).

## 15. Phased implementation plan

Each phase ends with a validation gate.

| Phase                               | Deliverable                                                                                                              | Validation                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **1. Registry + control-DB schema** | `cp_workspace_*` DDL in a new package; matches `registry.ts` contract                                                    | App boots in pooled mode against a hand-seeded registry row; reader validates it                                       |
| **2. Provisioner CLI**              | Create DB → migrate → stamp fingerprint/canary → insert registry+hostname → seed SSO admin                               | Provision 2 apps; `verify-workspace-secrets.ts` passes; both serve their own portal                                    |
| **3. Pooled with 2 tenants**        | Both apps live on distinct hosts                                                                                         | `apps/web/workspace-probe/` shows isolation (each host serves only its own data); cross-tenant access refused          |
| **3.5. Fleet-admin auth realm**     | Better Auth on control DB + OIDC; `cp_fleet_admins`; role mapping; admin-host bypass (§7.5)                              | SSO login reaches `/fleet`; non-admins rejected; tenant sessions unaffected                                            |
| **4. Cross-tenant engine**          | Fan-out reads + scoped writes with bounded concurrency, timeouts, partial results; SSO-admin-as-principal in each tenant | Aggregated read merges both apps, tags by app, degrades gracefully when one DB is down                                 |
| **5. Control-tower UI**             | Unified inbox → feedback → roadmap → changelog → dashboard; drill-in + scoped actions; `cp_fleet_audit` on writes        | Reply to app A's ticket and change app B's roadmap from one screen; audit rows recorded; per-tenant authorship correct |
| **6. Harden & operationalize**      | Fleet RBAC, audit, rate limits, backups, fleet-migrator on deploy, dormancy tuning                                       | Upgrade dry-run: pull upstream, `fleet-migrator run`, tests + probe pass                                               |

## 16. Validation & testing strategy

- **Isolation:** `apps/web/workspace-probe/` (the built-in cross-tenant leak instrument) after every tenancy change and every upstream upgrade.
- **Local proof:** stand up control DB + 2 tenant DBs on one node; provision both; run one `all` process; verify end-user isolation and a minimal unified inbox read/write path before any deploy.
- **Fingerprint/canary negative tests:** deliberately mis-wire a registry row (wrong DB, cloned DB) and confirm `503 REFUSED` with the right reason.
- **Worker:** confirm a `worker` replica drains each tenant's `job_queue`.
- **Upgrade rehearsal:** pull a new upstream release onto a staging fleet, run `fleet-migrator run`, then `bun run test` + probe.

## 17. Open questions (for the next planning rounds)

1. Subdomains vs custom domains (or both) for tenants, and the TLS strategy (wildcard vs per-domain).
2. Tenant onboarding: provisioner-seeds the admin vs first-SSO-login-claims — per app or uniform?
3. Which IdP / OIDC provider, and the group/claim → fleet-role mapping.
4. Shared Postgres cluster with DB-per-tenant vs dedicated clusters; backup/restore per tenant.
5. Shared MinIO/S3 bucket (prefix isolation) vs bucket-per-tenant, and object-storage credentials strategy.
6. Do we need per-tenant inbound email soon enough to prioritize the upstream signing-secret fix?
7. Control tower in the same deployment (upstream the bypass seam) vs. a separate admin process — final call.

## 18. Appendix — file/seam index

Runtime (existing):

- `apps/web/src/lib/server/workspaces/TENANCY.md` — authoritative pooled design
- `workspaces/mode.ts`, `config.ts` — tenancy switch/config
- `workspaces/registry.ts` — registry reader (`SELECT_COLUMNS`, `listActiveWorkspaces`, `resolveWorkspaceById`)
- `workspaces/resolver.ts`, `request-scope.ts`, `middleware/workspace-context.ts` — request resolution + `FLEET_PATHS`
- `workspaces/workspace-context.ts` — `withWorkspaceScopeById`, `getCurrentWorkspace`, `runWithWorkspaceScope`
- `workspaces/pool-cache.ts`, `fingerprint.ts`, `physical-identity.ts`, `activity.ts`, `fleet.ts`
- `workspaces/workspace-secrets.ts` (`setWorkspaceSecretsResolver`), `workspaces/vendor/*` (contract + crypto), `workspaces/__tests__/vendor-parity.test.ts`
- `jobs/worker.ts`, `jobs/JOBS.md`, `process-role.ts`, `startup.ts`
- `apps/web/scripts/fleet-migrator.ts`, `fleet/schema-state.ts`, `apps/web/scripts/verify-workspace-secrets.ts`
- `storage/namespace.ts`, `storage/s3.ts`
- `auth/index.ts`, `auth/trusted-origins.ts`, `auth/signup-policy.ts`, `domains/principals/bootstrap-admin.ts`, `workspaces/provenance.ts`
- Cloud gating (kept off): `domains/settings/cloud/*`, `tier-limits.service.ts`, `functions/owner-workspaces.ts`, `control-plane/client.ts`
- Onboarding: `functions/onboarding.ts`, `setup-state.ts`, `packages/db/src/types.ts`
- Domains reused by the tower: `domains/conversation/*`, posts/boards, roadmap, changelog

New (to build, additive):

- `packages/fleet-control/` — `cp_*` migrations, provisioner CLI, `cp_fleet_admins` / `cp_fleet_audit`
- Fleet-admin auth realm (Better Auth on control DB + OIDC)
- `/fleet/*` routes + cross-tenant engine + unified surfaces

Upstream (PR, not fork):

- Env-configurable workspace-exempt admin prefix in `workspaces/request-scope.ts`
- (Later) per-tenant inbound-email signing (`EMAIL_INBOUND_SIGNING_SECRET`)
