# Fleet Control Tower (separate app) + Provisioner — Design Plan v2

> **Status:** v2 (round-2 revision) — supersedes `plans/v1/multi-tenant-control-tower-plan.md`. Planning only.
> **Depends on:** Foundations (F-1 fork migration lineage, F-3 fork MCP registration, `fork_settings`);
> `10-rbac-persona-extensions.md` Phase 1a (D3: custom roles enforced on MCP) and its persona templates
> (tenant roles for every tower role bundle); `60-announcements-banner.md` (fork announcement MCP tools) for
> Phase 6; `50-prioritization-scoring.md` (MCP exposure) for Phase 7; `30-tiered-support.md` (tier teams) for
> Tier bundles.
> **Decisions applied:** D1, D2, D3, D4, **D-C1** (separate app), **D-C2** (human-attributed actions via app
> MCP + per-user OAuth), **D-C3** (one shared Aurora cluster, DB + role per app), **D-C4** (root key in AWS
> Secrets Manager, tower never holds it), 🟡 **D-C5** (seed role mapping), **D-C6** (wildcard subdomains +
> ACM), **D-C7** (OIDC or SAML IdP), **D-C8** (fleet-level backups), **D-C9** (configurable role bundles),
> **D-C10** (one S3 bucket, per-app prefix), **D-C11** (per-app inbound email), **D-C12** (no consent screens,
> silent "connect all"), **D-N8** (Fleet Agents publish announcements). Build position: last (README build
> order); Phase 8 (inbound email) may run in parallel once Phase 2 is done.

## Round-2 changes

| Change                                                                                                                                                                                                                  | Driven by   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Tower login supports **OIDC and SAML** (Better Auth SSO plugin in the tower). Apps get SAML through an OIDC broker, because upstream `apps/web` is OIDC-only (verified, §4.5.1). Group/claim → tower role is a table.     | D-C7        |
| Fixed `observer/agent/owner` enum replaced by **configurable role bundles**: `tower_roles` (capabilities + tenant `template_key`) + `tower_role_members` + `tower_claim_role_mappings`. `sync-admins` → `sync-members`, multi-role. | D-C9, D-R4  |
| **Consent screens removed:** the provisioner sets `skip_consent` on the tower's client; new "connect all apps" silent SSO chain (§4.5.3) with failure handling. Old O-5/O-6 removed.                                  | D-C12       |
| One shared Aurora cluster (control DB in it too); "or separate instance" option dropped.                                                                                                                                | D-C3        |
| Backups: fleet cluster only (snapshots + PITR). Per-app backup/restore removed.                                                                                                                                         | D-C8        |
| Storage: one fleet S3 bucket, per-app prefix `w/<settings.id>/` applied by upstream; no per-app bucket credentials.                                                                                                     | D-C10       |
| **New §4.11 + Phase 8: per-app inbound email** (fork seam IE-1 + an SES edge). Replaces the "inbound email off" caveat. Permanently fork-only.                                                                        | D-C11, D1   |
| Announcements: Fleet Agent seed bundle may publish (was owner-only). Tool names aligned with 60 (`list_/upsert_/archive_announcement`).                                                                                 | D-N8        |
| MCP registration line is now shared seam F-3 (not counted here). Old S-2 renamed to C-1 (matches `SEAMS.md`).                                                                                                          | 02 §10      |
| Open items reduced to D-C5 plus two new items. V-1 (RDS Proxy pinning) and V-4 (token lifetimes) stay as Phase 0 validations. O-4 closed by 02 §3.3 / X-R1; O-7 closed by X-R6.                                          | 01 Still open |

## 1. Changes from v1

| v1 issue (review §3.1 / §2)                                                                                                                    | v2 resolution                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Blocker:** `/fleet/*` in the tenant app hits the root `beforeLoad` (`routes/__root.tsx:74-89`, exemptions hard-coded in `ONBOARDING_EXEMPT_PATHS` `:57-68`) which needs a workspace scope | **Eliminated by D-C1.** The tower is `apps/control-tower/`, its own process, router and root route. Zero edits to `__root.tsx`.                                                                                                                                                                                                |
| **Blocker:** a path bypass would miss server functions (`/_serverFn/…`); `FLEET_PATHS` is a hard-coded list (`workspaces/request-scope.ts:70-75`, checked at `:88`) | **Eliminated by D-C1.** No workspace-exempt prefix is needed; `request-scope.ts` is untouched.                                                                                                                                                                                                                                  |
| **Blocker:** provisioner must write the stamped `settings` row, admin principal and setup state (onboarding refuses on `settings_row_missing`, `fingerprint.ts:119,186`; bootstrap claim closed for stamped DBs, `bootstrap-admin.ts:90`) | §4.3: the provisioner writes settings (+ `setupState` with `completionSource: 'managed'`), stamp, canary, member principals, roles, IdP + linked `account` rows itself. No onboarding wizard, no bootstrap claim.                                                                                                              |
| **Major:** in-process fan-out shares the per-request auth memo (`functions/auth-request-cache.ts:26`) across tenants                            | **Eliminated.** The tower never enters an app process; each call is an independent HTTPS MCP call authenticated by that app.                                                                                                                                                                                                 |
| **Major:** contract requires distinct pooled/direct endpoints and matching role/db (`vendor/contract.ts:422-438, 446-451`); role per tenant      | D-C3: pooled DSN → RDS Proxy endpoint, direct → writer endpoint (different hosts), one DB role + DB per app, password-less DSNs with `role@…/db` matching `db_role`/`db_name`. §4.2.                                                                                                                                             |
| **Major:** second Better Auth instance needs its own tables                                                                                      | The tower runs its own Better Auth with its own tables (`tower_auth_*`) in the control DB, own lineage in `apps/control-tower/migrations`. §4.5.                                                                                                                                                                              |
| **Major:** fleet code would trip module-state / authz CI                                                                                         | Tower code is outside `apps/web` scan roots. Fork code inside `apps/web`: provisioner (`lib/server/fork/provisioner/`), inbound-email key (`lib/server/fork/inbound-email/`), one public API route, and fork MCP tools under `mcp/tools/fork-*.ts` (attested by `policy/authz-matrix/scan.ts:321` `scanAllMcpTools`). No module state. |
| **Wrong fact:** fingerprint columns 0251/0252                                                                                                    | Real: `0255_settings_cloud_tenant_id.sql` → renamed by `0256_workspace_key_columns.sql` (`cloud_workspace_key`); canary `0266_settings_cloud_secret_canary.sql`. Not in the Drizzle schema; read via `to_jsonb(s) ->> …` (`fingerprint.ts:262-263`).                                                                           |
| **Wrong fact:** `OSS_TIER_LIMITS` location; service names                                                                                        | Moot: seat/plan limits do not apply (D4), and the tower calls MCP tools, not services.                                                                                                                                                                                                                                         |
| **Wrong fact:** `env://` refs                                                                                                                    | `env://` only accepts `QUACKBACK_TENANT_SECRET_[A-Z0-9_]+` (`vendor/secret-ref.ts:141-142`). v2 uses `sealed+aead://` for DB passwords, so onboarding an app needs no task-definition change (§4.2).                                                                                                                             |
| **Human attribution:** API keys mint a service principal per key (`api-key.service.ts:132`)                                                       | D-C2: the tower acts only through app MCP with the user's own OAuth token; `principalId` comes from the verified JWT and is re-read from `principal` (`mcp/handler.ts:98-126`). Dual audit (§4.8).                                                                                                                             |
| X6: `withWorkspaceScopeById` wrong file/signature                                                                                                | It is `workspaces/fleet.ts:147` with `(workspaceKey, origin: WorkspaceScopeOrigin, body)`. Only the provisioner uses it (origin `'script'`).                                                                                                                                                                                  |
| §4.2/4.3: fleet `viewer` clashes; fleet admins all seeded as tenant **admin**                                                                    | Configurable tower role bundles (D-C9), each naming a tenant custom-role template from 10 (§6). Enforced over MCP once D3 ships.                                                                                                                                                                                               |
| v1 §7.1 registry DDL "reverse-engineer later"                                                                                                    | §5.1 concrete DDL reproducing `SELECT_COLUMNS`/`RegistryRow` + **parity test** against the real reader.                                                                                                                                                                                                                      |
| v1 control DB schema in `packages/`                                                                                                              | Control-DB migrations are their own lineage in `apps/control-tower/migrations/`, never in `packages/db`.                                                                                                                                                                                                                      |
| v1 fan-out design (in-process, limit 5)                                                                                                          | MCP fan-out with bounded concurrency, per-app timeouts, partial results, explicit dormancy policy (§4.7).                                                                                                                                                                                                                      |
| v1 surfaces assumed domain services for every action                                                                                             | Verified MCP coverage table (§4.6); gaps become fork MCP tools registered through shared seam F-3.                                                                                                                                                                                                                             |
| Caveats (inbound email, `PLATFORM_CREDENTIALS_SOURCE`)                                                                                           | Inbound email is now built (D-C11, §4.11). Platform credentials re-verified (§4.10).                                                                                                                                                                                                                                            |
| Fleet migrator + fork lineage                                                                                                                    | Fork-only releases are not claimed by the fleet migrator; the provisioner's `fork-migrate` command is adopted in `02-fork-conventions.md` §3.3 (X-R1).                                                                                                                                                                        |

## 2. Requirements

- **R1** Each app is an isolated Quackback workspace served by the upstream pooled runtime
  (`QUACKBACK_TENANCY=pooled`) in `apps/web`; end users never see another app.
- **R2** Fleet users sign in **once** to the tower through the org IdP, which may be **OIDC or SAML** (D-C7).
  Each app is configured with the same IdP by the provisioner.
- **R3** The tower aggregates support inbox, tickets, feedback, roadmap, changelog and per-app counts across
  all active apps; it degrades per app (partial results).
- **R4** The tower acts on one app at a time; **every action is attributable to the human** in both the tower
  audit and the app's native activity/audit (D-C2).
- **R5** Tower authorization is **configurable role bundles** (D-C9). A bundle sets which tower surfaces and
  actions a user gets **and** which custom role the user holds in every app. Users may hold several bundles
  (D-R4). App RBAC still bounds what each app accepts (defence in depth).
- **R6** Connecting to all apps shows **no consent screens** and needs no clicks while the IdP session is live
  (D-C12).
- **R7** Provisioning, suspension and member sync are privileged jobs holding the root key; the tower never
  holds `QUACKBACK_FLEET_ROOT_KEY` nor any app DSN credential (D-C4).
- **R8** Each app receives inbound email on its own address, verified with its own key (D-C11).
- **R9** Upgrade safety: ≤ 2 upstream seams owned by this plan (+1 conditional); upstream registry drift caught
  by a test.
- **Later:** R10 announcements across apps (Phase 6, D-N8); R11 read-only portfolio / prioritization views
  (Phase 7).

## 3. Architecture

```
              org IdP (OIDC or SAML)      SAML only: OIDC broker in front of the IdP for apps (§4.5.1)
               │                │
  tower login  │                │  app SSO (pre-linked account; silent while IdP session is live)
  (OIDC/SAML)  ▼                ▼
 ┌────────────────────┐  HTTPS MCP (Bearer = user's per-app token)  ┌────────────────────────────┐
 │ apps/control-tower │ ─────────────────────────────────────────▶ │ apps/web (pooled, N hosts) │
 │  Better Auth + SSO │                                             │  /api/mcp, /api/auth/oauth2 │
 │  tower_* tables    │◀── column-limited SELECT ── control DB ───▶ │  registry reader            │
 └────────┬───────────┘                                             └──────┬───────────▲──────────┘
          │ ECS RunTask (no secrets)                                        │           │ raw MIME + HMAC
          ▼                                                                 ▼           │
 provisioner task (apps/web image, root key) ──▶ one Aurora cluster: DB per app   apps/mail-edge (SES → Lambda)
                                                 + fleet S3 bucket (w/<settings.id>/)
```

Two planes; the tower is a pure **client** of the app plane.

## 4. Design

### 4.1 App plane (unchanged upstream runtime)

`apps/web` runs pooled exactly as upstream documents (`workspaces/TENANCY.md`): Host → registry
(`resolveWorkspaceByHostname`, `registry.ts:265`) → pool (`pool-cache.ts`) → fingerprint. Web/worker/migrator
tasks get `QUACKBACK_CONTROL_DATABASE_URL` (role `cp_reader`) and `QUACKBACK_FLEET_ROOT_KEY` from Secrets
Manager. App hostnames (D-C6): `<slug>.<fleet-domain>` on an ALB with an ACM wildcard certificate; tower on
`tower.<fleet-domain>` behind a separate internal ALB/VPN listener. Custom domains per app come later
(`kind = 'custom'` hostnames).

### 4.2 AWS database layout (D-C3, D-C8)

- **One shared Aurora PostgreSQL cluster.** One database + one login role per app (`qb_<key>` / `qb_<key>`),
  owner of its DB, no cross-DB grants. The control DB `quackback_control` lives in the same cluster.
- `db_pooled_url = postgresql://qb_<key>@<proxy-endpoint>:5432/qb_<key>?sslmode=require`
  `db_direct_url = postgresql://qb_<key>@<cluster-writer-endpoint>:5432/qb_<key>?sslmode=require` — different
  hosts, so `contract.ts:422-438` passes; role/db match `db_role`/`db_name` (`contract.ts:446-451`).
- `db_credential_ref = sealed+aead://v<gen>/<key>/db/<blob>` — password sealed under the root key by the
  provisioner. `env://` is rejected because each new app would need a new `QUACKBACK_TENANT_SECRET_*` env var
  and a task-definition roll (`secret-ref.ts:141-142`).
- RDS Proxy authenticates each client role from a Secrets Manager secret; the provisioner creates
  `quackback/tenant/<key>/db` and attaches it to the proxy's auth list (IAM auth off — see V-2).
- **Backups (D-C8):** Aurora automated backups + PITR and scheduled cluster snapshots only. There is no
  per-app backup or per-app restore procedure; restoring means restoring the cluster (or a clone of it) and
  is an ops runbook item (Phase 9).
- **Validation tasks (Phase 0):**
  - **V-1 RDS Proxy pinning.** `pool-cache.ts:179,402` hard-code `prepare: true` (rationale `TENANCY.md:204-207`).
    RDS Proxy may pin sessions on extended-protocol prepared statements. Measure
    `DatabaseConnectionsCurrentlySessionPinned` under load. If pinning defeats pooling, apply conditional seam
    **C-1** (env-driven `prepare`). Zero-seam alternative: point `db_pooled_url` at a second DNS name for the
    writer (satisfies the host rule, no pooling; acceptable at 5–10 apps with `WORKSPACE_POOL_MAX=3`).
  - **V-2 IAM auth.** `secret-ref.ts` resolves `env://`, `sealed+aead://` and `derived+hkdf://` only; no IAM-token
    ref. Use password auth (a custom `setWorkspaceSecretsResolver`, `workspace-secrets.ts:90`, is not planned).
  - **V-3** `DSN_RE` accepts `?sslmode=require`; `pg_cluster_id`/`pg_database_oid` read correctly through RDS
    Proxy (anti-clone check in `physical-identity.ts`).

### 4.3 Provisioner (privileged job; holds the root key)

**Where:** logic in `apps/web/src/lib/server/fork/provisioner/*.ts`, entry `apps/web/scripts/fork-provision.ts`
(new files; no seam). It runs from the **apps/web image** as an ECS task with the provisioner task role
(root key + RDS master secret + `secretsmanager:CreateSecret` + `rds:ModifyDBProxy`), because it reuses the
vendored contract (`workspaces/vendor/*`), `runMigrations`, app defaults and domain services. The tower
triggers it with `ecs:RunTask` (command + args only; no secrets pass through the tower).

Commands: `create`, `sync-members`, `suspend`, `resume`, `deprovision`, `rotate-db-password`, `fork-migrate`
(§4.4), `verify` (wraps `apps/web/scripts/verify-workspace-secrets.ts` and the checks below).

`create --key <key> --slug <slug> --name <name> [--mail-slug <s>]` (idempotent; each step checks before writing):

1. `CREATE ROLE qb_<key> LOGIN PASSWORD …; CREATE DATABASE qb_<key> OWNER qb_<key>` (master creds); create the
   Secrets Manager secret; attach it to RDS Proxy.
2. Migrate via `runMigrations(directDsn)` (`packages/db/src/migrate-runtime.ts:202`): upstream lineage, then
   the fork lineage (F-1), then `seedSystemData`.
3. Derive the workspace `SECRET_KEY` via vendored `fleet-secrets.ts` (`deriveWorkspaceSecret`, `:137`) from
   `derived+hkdf://v1/<key>/app-secrets`.
4. In one transaction on the direct DSN, insert the **settings row**, mirroring `functions/onboarding.ts:265-279`
   (`id = generateId('workspace')`, name, slug, `DEFAULT_PORTAL_CONFIG`, `DEFAULT_WIDGET_CONFIG`,
   `DEFAULT_ASSISTANT_CONFIG`, `authConfig` **without** `openSignup`, `featureFlags`) with `setupState` = all
   steps complete, `completionSource: 'managed'` (`packages/db/src/types.ts:353`) so `isOnboardingComplete`
   (`types.ts:561`) is true; then
   - fingerprint stamp `{ v: 1, workspaceKey, stampedAt }` (`vendor/contract.ts:524-545`) into
     `settings.metadata.cloudTenant`; leave `cloud_workspace_key` NULL (avoids `stamp_source_conflict`);
   - `cloud_secret_canary = sealSecretKeyCanary(secretKey, key)` (`vendor/fleet-secrets.ts:249`), raw SQL
     (column not in the Drizzle schema).
5. Read `pg_database.oid` + cluster id; insert `cp_workspace_registry` + `cp_workspace_hostnames`
   (`kind = 'platform'` for `<slug>.<fleet-domain>`) + `cp_workspace_schema_state` (target = image max).
   - `storage` (D-C10) = the **fleet-bucket form**: `{ provider: 'r2', bucket: <fleet bucket>, endpoint:
     https://s3.<region>.amazonaws.com, region, forcePathStyle: false, publicUrl: <fleet CDN origin> }` with
     **no `credentialRef`** — absent is the documented pooled default ("the isolation is in the key rather
     than in the key pair", `vendor/contract.ts:88-102`). Every object name is composed under
     `w/<settings.id>/` by `storage/namespace.ts` (`WORKSPACE_NAMESPACE_ROOT = 'w'` `:61`,
     `workspaceNamespace` `:103`, `composeNamespacedKey` `:114`). No per-app bucket or bucket credential.
   - `mail_slug` (D-C11) = `--mail-slug` or the slug; must match the mail-slug grammar, **max 13 characters**
     (`vendor/mail-slug-pattern.ts:31`; the local-part budget in `conversation.email-channel.ts:169-175`), and
     is `UNIQUE` in the registry. The provisioner refuses a longer slug rather than truncating.
6. Enter the scope with `withWorkspaceScopeById(key, 'script', …)` (`fleet.ts:147`) — runs the real fingerprint
   + canary checks — and, using domain services:
   - `ensureNewWorkspaceLabs` (as onboarding does);
   - `ensurePersonaRoles` (owned by 10; same service behind its MCP tool `fork_install_persona_roles`) for every
     `template_key` named by any `tower_roles` row; roles are then looked up by `template_key` in 10's
     `fork_role_templates(role_id PK, template_key unique)`, never by display name;
   - create the app **identity_provider** row (`packages/db/src/schema/auth.ts:682`; `enabled`,
     `autoCreateUsers=false`, `showButton=true`) pointing at the org IdP (OIDC) or the OIDC broker (SAML IdP,
     §4.5.1), + `sso_verified_domain` for the org email domain; client secret via the identity-provider
     credential service (encrypted under the workspace key);
   - `sync-members` (below);
   - register the tower's **OAuth client** and set `skip_consent` (§4.5.2); write `fork_settings` keys
     `tower.oauth_client_id`, `tower.redirect_uri`, `tower.sso_provider_id` (read by §4.5.3);
   - ensure `developerConfig.mcpEnabled` (default `true`, `settings.types.ts:509`).
7. `verify`: `resolveWorkspaceById` ok, `verify-workspace-secrets.ts` passes, `GET https://<host>/` 200,
   tower client has `skip_consent = true`, storage write/read round-trip lands under `w/<settings.id>/`.

**`sync-members`** (per app; re-run whenever `tower_role_members`, `tower_roles` or `tower_users` change):
read active tower users with their bundles (read-only grant), and for each user:

- upsert `user` (email, name, `emailVerified`) and `principal`: legacy role `admin` if **any** of the user's
  bundles has `tenant_legacy_role = 'admin'` (Fleet Owner seed), else `member`;
- a pre-linked `account` row (`providerId = <identity_provider id>`, `accountId = <IdP sub>`) so the first SSO
  sign-in lands on this principal **without relying on email auto-linking** (auto-linking is "observed, not
  enforced", `auth/index.ts` comment above `allowsAutoLinking`);
- **multi-role (D-R4):** one `principal_role_assignments` row (`schema/rbac.ts:62`; unique on
  `(principal_id, role_id) WHERE team_id IS NULL`) per distinct tenant template across the user's bundles.
  Tier bundles are assigned the way 30 requires for tier roles (team membership / team-scoped assignment,
  D-A8 roll-up) through 30's service, not by this plan;
- removes assignments to **tower-managed templates** (roles whose `template_key` is named by some `tower_roles` row) that the user
  no longer holds; assignments to other roles (set by the app's own admins) are never touched.

Disabled users: tower-managed assignments removed, principal demoted to `user`, grants revoked (§4.5.2).
Upstream IdP claim mapping only assigns **legacy** roles (`oidc-claim-mapping.ts:98-110`, `KNOWN_ROLES`), so
custom-role assignment has to be explicit — hence `sync-members` rather than app-side claim mapping.

### 4.4 Fleet migrations and the fork lineage

Upstream `apps/web/scripts/fleet-migrator.ts` (`run | status | enrol | set-target | block | plan`, `:41-53`)
reconciles apps via `runMigrations`, so the fork lineage rides along through F-1. A release containing only
fork migrations is never claimed (`fleet/schema-state.ts:121`; `set-target` above the image max is refused,
`fleet/migrator.ts:882-899`). Provisioner command `fork-migrate [--workspace]` iterates `listActiveWorkspaces()`
and applies only the fork lineage (ledger `drizzle.__fork_migrations`) on each direct DSN under the same
advisory lock. Deploy order: `fleet-migrator run` → `fork-provision fork-migrate` (adopted in 02 §3.3, X-R1).

### 4.5 Identity, role bundles and app grants

#### 4.5.1 Tower login (D-C7) and SAML for apps

`apps/control-tower` (TanStack Start or Hono + React; own `package.json`, picked up by the root
`workspaces: ["apps/*"]` glob; `bun.lock` regenerated on merge). Better Auth with the **SSO plugin
(`@better-auth/sso`)**, which registers OIDC and SAML 2.0 providers from configuration; tables
`tower_auth_user|session|account|verification|sso_provider` via `modelName` mapping. The IdP (either protocol)
is configuration, not code. No self-signup: a subject with no role after claim mapping is refused. Cookie on
`tower.<fleet-domain>` only; MFA enforced at the IdP. Plugin version and SAML feature set verified in Phase 4
(**V-8**).

**Claim → role mapping is data** (`tower_claim_role_mappings`, §5.2): on every sign-in the tower reads the
configured claim path (OIDC claim or SAML attribute, e.g. `groups`), computes the set of matching roles, and
replaces the user's `source = 'claim'` memberships with it (`source = 'manual'` memberships, granted in the
tower UI by `roles.manage`, are kept). A change triggers `sync-members` for all apps.

**Apps and SAML (verified):** upstream `apps/web` signs in through Better Auth `genericOAuth` only
(`auth/index.ts:764`); `identity_provider` models OIDC (`discoveryUrl`, `issuer`, `kind` okta/auth0/keycloak/
entra/google/other, `schema/auth.ts:682-698`); the only SAML references are comments about "SAML-to-OIDC
bridges" (`auth/map-profile-claims.ts:13`, `lib/shared/oidc-claim-mapping.ts:205`). No `@better-auth/sso` in
`apps/web/package.json`. So:

- **OIDC IdP:** each app's `identity_provider` points straight at it.
- **SAML IdP:** apps point at an **OIDC broker** that federates the SAML IdP (e.g. Keycloak or an AWS Cognito
  user pool). Zero seams; the broker session makes app SSO silent exactly as a native OIDC session would. The
  tower may use the SAML IdP natively or the same broker.
- Rejected: native SAML in `apps/web` (adding the SSO plugin to `auth/index.ts`, a SAML shape on the upstream
  `identity_provider` schema, login UI) — several seams in high-churn upstream auth files. See **O-2**.

#### 4.5.2 Per-app OAuth grant (D-C2, D-C12)

Verified facts about the app authorization server:

- `@better-auth/mcp` 1.7.4 (`apps/web/package.json:27`), registered in `auth/index.ts:721-760`: `loginPage
  '/auth/login'`, `consentPage '/oauth/consent'`, dynamic client registration on by default (toggle
  `developerConfig.oauthDynamicClientRegistrationEnabled`), scopes `MCP_AS_SCOPES` = `openid profile email
  offline_access` + `read:feedback write:feedback write:changelog read:article write:article read:chat
  write:chat` (`lib/shared/api-key-scopes.ts:19-48`).
- `/auth/login` redirects to the portal root with the sign-in dialog (`routes/auth.login.tsx:11-15`,
  `lib/shared/auth-prompt.ts:24-31`) — i.e. without an app session, authorize **needs a click**. §4.5.3 removes
  that click.
- Tokens are JWTs **audience-bound to that app** (`${baseUrl}/api/mcp`, `handler.ts:89-95`) ⇒ one grant per
  (user, app). `customAccessTokenClaims` embeds `principalId` (`auth/index.ts:748-760`); the handler re-reads
  the role on every call (`handler.ts:106-113`).
- Refresh tokens: `offline_access`, rotated on refresh with family revocation on reuse, softened by
  `OAUTH_REFRESH_GRACE_SECONDS` (default 7 d, `auth/refresh-grace.ts`).
- `oauth_client.skip_consent` exists (`schema/auth.ts:1003`).
- Step-up: missing scope → HTTP 403 `insufficient_scope` (`handler.ts:210-247`).

Design:

- **Client registration:** the provisioner registers one confidential client per app ("Quackback Control
  Tower", `redirect_uri = https://tower.<fleet-domain>/oauth/callback/<key>`, `client_secret_basic`,
  `authorization_code refresh_token`) through the app's public RFC 7591 endpoint, then — inside the workspace
  scope — sets **`skip_consent = true`** on that one `oauth_client` row (D-C12: the tower is a trusted
  first-party client). `client_id/secret` go to the tower sealed with the tower's KMS key into
  `tower_tenant_clients`. Attribution is unchanged: the human still authenticates to the app.
- **Scopes requested** = union of the OAuth scopes required by the user's tower capabilities (§6), plus
  `openid email offline_access`. When a user gains a capability that needs a new scope, the grant is marked
  `needs_reconnect` and re-obtained by the silent flow.
- **Storage:** `tower_tenant_grants` holds refresh + current access token, envelope-encrypted with a KMS data
  key (tower CMK, tower task role only). Access tokens refreshed on demand under a row lock per grant (tower
  replicas never refresh the same grant concurrently, avoiding reuse-triggered family revocation). Refresh
  failure → `needs_reconnect`.
- **V-4 (validation):** access/refresh-token TTLs of the deployed plugin; that `skip_consent` suppresses the
  consent page for `authorization_code` + PKCE. The tower relies on `expires_in` only.

#### 4.5.3 "Connect all apps" — silent SSO chain (D-C12)

Why it can be silent: (1) the user already has an **IdP session** from the tower login; (2) every app has an
`identity_provider` for that IdP and a **pre-linked `account`** for the user (§4.3), so app SSO completes
without any app-side prompt or account-linking step; (3) the tower's client has **`skip_consent`**. What is
missing upstream is only an entry point that starts app SSO without the sign-in dialog click. It is a new
fork file, **not a seam**: `apps/web/src/routes/api/fork/tower-connect.ts` (GET):

1. Validates `next` is a same-origin `/api/auth/oauth2/authorize` URL whose `client_id` equals
   `fork_settings.tower.oauth_client_id` and whose `redirect_uri` equals `tower.redirect_uri`. Anything else →
   400. (No open redirect: both targets come from `fork_settings`, written by the provisioner.)
2. If an app session exists → 302 to `next`.
3. Otherwise it calls Better Auth's social sign-in server-side for `tower.sso_provider_id` (the path
   `startOidcSignIn` uses, `lib/client/start-oidc-sign-in.ts:7-20`) with `callbackURL = next` and
   `errorCallbackURL = /api/fork/tower-connect?failed=1&state=<state>`, forwarding the state cookie, and 302s to
   the IdP.
4. `failed=1` → 302 to `tower.redirect_uri?error=sso_failed&state=<state>` so every failure returns to the tower.

The route has no `requireAuth`/`withApiKeyAuth` gate, so the authz-matrix scan (`scan.ts:30-41`) records
nothing and no `classifications.ts` entry is needed.

Chain, per run:

1. Tower creates `tower_connect_runs` (queue of apps lacking a live grant with the needed scopes). It pre-checks
   each app with `GET https://<host>/api/health` and marks unreachable apps `skipped: unreachable`.
2. For the head of the queue: tower generates PKCE + `state` (run id, app key, nonce; verifier kept
   server-side) and navigates the top window to `https://<host>/api/fork/tower-connect?next=<authorize URL>`.
3. App → IdP (session live, returns immediately) → app callback (pre-linked account, session) → authorize
   (`skip_consent`) → `tower/oauth/callback/<key>?code=…`.
4. Tower exchanges the code, checks `id_token` `sub`/email match the tower user (else revoke + `failed:
   identity_mismatch`), stores the grant, and immediately redirects to the next app's `tower-connect` URL.
5. After the last app: summary page (connected / failed with reason / skipped).

Failures: IdP needs interaction (expired session, MFA step-up) → the IdP page shows, then the chain resumes on
its own; app SSO error, disabled or unlinked account → `failed: sso_failed` via step 4 of the route; consent
page appears (client lacks `skip_consent`) → user may approve, and `verify` reports the misconfigured app;
OAuth `error=` on the callback → `failed: <error>`; user abandons mid-chain → the run stays open and the tower
home offers "resume" (next hop continues from the queue). A failed app never blocks the rest of the chain.

### 4.6 MCP coverage for tower surfaces

Verified in `apps/web/src/lib/server/mcp/tools/*.ts` (index `tools/index.ts:1-50`):

| Surface          | Existing tools (file)                                                                                              | Gap → fork tool (`mcp/tools/fork-fleet.ts` unless noted)                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Support inbox    | `list_conversations`, `get_conversation`, `reply_to_conversation` (auto-assigns), `set_conversation_status` (conversations.ts) | `assign_conversation` (→ `assignConversation`, `conversation.service.ts:1477`; team via `assignTeam` `:1542`) |
| Tickets          | `list_tickets`, `get_ticket`, `create_ticket`, `reply_to_ticket`, `add_ticket_note`, `link_ticket`, `unlink_ticket` (tickets.ts) | `assign_ticket` (`ticket.service.ts:744`), `set_ticket_status` (`ticket.service.ts:415`) |
| Feedback         | `search`, `get_details`, `triage_post`, `merge_post`, `unmerge_post`, `delete_post`, `restore_post`, `get_post_activity`, comment tools | —                                                                             |
| Roadmap          | resource `quackback://roadmaps` (read); column = post status (`roadmap.types.ts:23`) so a move is `triage_post {statusId}` | `list_roadmap_posts` (→ `getRoadmapPosts`, `roadmap.query.ts:214`)            |
| Changelog        | `create_changelog`, `update_changelog`, `delete_changelog`, `search {entity:"changelogs"}`                         | —                                                                             |
| Dashboard counts | none                                                                                                               | `get_workspace_overview` (→ `getAdminOverview`, `admin-overview.query.ts:69`)  |
| Announcements    | none                                                                                                               | `fork-announcements.ts` (owned by 60): `list_announcements`, `upsert_announcement`, `archive_announcement`, `list_announcement_templates` |
| Portfolio        | `get_details` (score, owned by 50)                                                                                 | `list_prioritized_posts` in `fork-prioritization.ts` (owned by 50), read-only  |

Rules for fork tools: `registerTool` with `{ scope, teamOnly: true }` (`tools/helpers.ts:150-199`) — the MCP scan
attests name/scope/teamOnly (`scan.ts:297-322`); after D3 they also check the permission key through the 10-rbac
actor helper using existing keys (`conversation.assign`, `ticket.assign`, `ticket.set_status`,
`analytics.view`) and 60's `announcement.manage`. Scopes: conversation/ticket → `read:chat`/`write:chat`;
roadmap/overview → `read:feedback`; announcements → `write:feedback` (`api-key-scopes.ts:211-227`). Registration
via shared seam **F-3** (`fork-index.ts` → `fork-fleet.ts`).

### 4.7 Fan-out

- App list: tower reads `cp_workspace_registry` (state `active`) + hostnames + `cp_workspace_activity` through
  a **column-limited grant** (no `db_*`, `*_ref` columns).
- Per request: `mapWithLimit(apps, TOWER_FANOUT_CONCURRENCY=6, t => withTimeout(mcpCall(t, tool, args),
  TOWER_TENANT_TIMEOUT_MS=4000))`; results tagged `{workspaceKey, hostname}`; failures returned as
  `degraded[{key, reason: timeout|needs_reconnect|http_<code>|refused}]`; merged/sorted in the tower.
  Composite cursor `{key: toolCursor}`. Only apps where the viewer holds a live grant are queried.
- MCP transport is stateless JSON (`handler.ts` `enableJsonResponse: true`); one POST per tool call.
- **Dormancy:** every MCP call is an activity signal (`workspaces/activity.ts:106-113`) and wakes a dormant
  app. So: no background polling; aggregate views skip apps whose `last_active_at` is older than
  `WORKSPACE_DORMANT_AFTER_HOURS` ("dormant — load" per app); dashboard counts cached 60 s per (user, app).
- Rate limit: per-user token bucket; bulk actions sequential per app with confirmation.

### 4.8 Actions and dual audit

Write flow: tower capability check → confirm dialog → `tower_audit` row `status='pending'` → MCP `tools/call`
with that user's token → update row `ok|denied|error` + app result ids. App side the domain service acts as the
user's principal, producing native records (post activity, conversation messages, changelog author).
Validation V-5: for every tool the tower calls, a native record naming the principal exists.

### 4.9 Announcements surface (Phase 6, D-N8)

Tower page composes one announcement and fans it out as `upsert_announcement` to selected apps with a shared
`broadcastId` (idempotent retries, owned by 60 §4.9), plus `list_announcements` / `archive_announcement`, and
a saved-text picker fed by `list_announcement_templates` (D-N4); per-app result list and a `tower_audit`
row per app. Gated by tower capability `announcements.publish`, which the **Fleet Owner and Fleet Agent seed
bundles both hold** (D-N8); app side requires `announcement.manage` (Admin; "Fleet Agent" template per the
shared names).

### 4.10 Caveats (re-verified)

- **Platform credentials:** `config.platformCredentialsSource` returns `'control-plane'` whenever
  `QUACKBACK_TENANCY=pooled` (`config.ts:635-637`); with `QUACKBACK_CONTROL_PLANE_URL` unset, integration OAuth
  apps relying on platform credentials are unavailable. Validate per integration (V-6); app SSO sign-in is
  **not** affected (identity_provider credentials are per-workspace).
- **Fleet S3 credential:** with no `credentialRef`, `s3.ts:210-219` uses `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`
  (no AWS default credential chain), so the fleet uses one IAM user scoped by bucket policy to the fleet bucket,
  keys in Secrets Manager. `provider` must be the literal `'r2'` (`vendor/contract.ts:286`); **V-7** confirms
  AWS S3 works through it (the client is generic S3; endpoint/region/path style come from the record).
- Process-wide AI keys / SMTP shared across apps (acceptable for one operator).
- Root-key blast radius (D-C4): Secrets Manager + KMS, only web/worker/migrator/provisioner task roles;
  rotation by bumping `v<gen>` (requires re-encryption; `stored-ciphertext.ts` — never re-stamp the canary over
  un-re-encrypted data). Rotating an app's `SECRET_KEY` also rotates its inbound address key (§4.11).

### 4.11 Per-app inbound email (D-C11; permanently fork-only per D1)

**Upstream today (verified):**

- Reply addresses are `<mailSlug>+<c|t><id-suffix>.<tag>@<inbound domain>`; the tag is
  `HMAC-SHA256(key, "<slug>\0<id>")` (`conversation.email-channel.ts:413-417`), minted by
  `inboundReplyToAddress`/`inboundTicketReplyToAddress` and verified by `claimVerifies` (`:546-552`). The key
  comes from `signingKey(env)` (`:243-248`), which reads the **process-wide** `EMAIL_INBOUND_SIGNING_SECRET`
  (`:143`). `TENANCY.md:673-676` calls one shared secret the blocker for enabling email on a pooled fleet.
- The mail slug is a registry field (`registry.ts:459`, `vendor/contract.ts:197`) read by `currentMailSlug()`
  from the current workspace scope (`conversation.mail-slug.ts`).
- Two front doors on `POST /api/chat/email/inbound`: the Resend webhook (Svix-verified with the same env secret,
  `email-webhook-handler.ts:37`) and the raw-MIME edge door (`email-cloudflare-handler.ts`), authenticated by a
  separate fleet key `INBOUND_HMAC_SECRET` (`:99`) over `timestamp.mailSlug.body`; it refuses mail whose signed
  slug is not this host's workspace (`deliveryNamesThisWorkspace`, `:374`, called at `:551`).
- CSAT email links already use the workspace `SECRET_KEY` (`csat-email-token.ts:35-39`), not the inbound secret.

**Fork change:**

1. **Per-app address key.** New `apps/web/src/lib/server/fork/inbound-email/address-key.ts`:
   `forkInboundAddressKey(): Buffer | null | undefined` — `undefined` when not pooled (upstream path
   unchanged for single-tenant); otherwise `HKDF-SHA256(getWorkspaceSecretKey(), salt 'quackback-fork',
   info 'fork:inbound-address:v1:<workspaceKey>:<currentMailSlug()>', 32)`, or `null` with no workspace scope
   (fail closed: no mint, no verify). `getWorkspaceSecretKey()` (`workspace-context.ts:229`) is synchronous
   and is itself `HKDF(root key, <key>, 'app-secrets')` (`vendor/fleet-secrets.ts:120-138`), so the address key
   is derived from the fleet root key without the app ever handling the root key and **without** adding a
   purpose to the vendored closed list `FLEET_SECRET_PURPOSES` (`fleet-secrets.ts:87`, which would be a seam in
   the vendored contract). No module state; pure function.
2. **Seam IE-1** — first line of `signingKey()` in `conversation.email-channel.ts`:
   `const forkKey = forkInboundAddressKey(); if (forkKey !== undefined) return forkKey`. Both minting
   (`signInboundTag`) and verification (`claimVerifies`) go through `signingKey`, so both become per-app.
   Mint and verify run inside the app's scope (senders via `currentMailSlug()`; the inbound door is resolved by
   Host), so the same key is derived on both sides.
3. **Routing by mail slug.** New fork app `apps/mail-edge/` (Lambda, fork-owned, no seam): SES receipt rule for
   `*@<inbound domain>` → raw message to S3 → Lambda reads the envelope recipient, normalises the slug exactly
   as `workspaceSlugFromInboundAddress` does (`conversation.email-channel.ts:612-617`), resolves
   `mail_slug → primary_hostname, state` through a column-limited control-DB role `cp_mail_router`, and POSTs
   the raw MIME to `https://<host>/api/chat/email/inbound` with the upstream edge wire contract
   (`email-cloudflare-handler.ts:10-20`). Unknown slug or non-active app → SES bounce; 5xx → retry via SQS DLQ.
   The edge key `INBOUND_HMAC_SECRET` stays fleet-wide: it only authenticates the edge, and because the slug
   is inside its signature a captured delivery cannot be re-aimed at another app (handler note 3). See **O-3**.
4. **Configuration.** `EMAIL_INBOUND_DOMAIN` = fleet inbound domain; `INBOUND_HMAC_SECRET` (edge key);
   `EMAIL_INBOUND_SIGNING_SECRET` must still be set (a random fleet value, never shared) because the
   "configured" gates test for it (`:270-271`, `:296-297`); under pooled it signs no addresses. The Resend door
   is unused on AWS. Set `EMAIL_EVENTS_SIGNING_SECRET` explicitly so SES/SNS delivery events do not fall back
   to it (`email/email-delivery-webhook.ts:32-35`).
5. **Rotation.** Bumping an app's `app-secrets` generation changes its address key; old Reply-To addresses
   then fail verification and replies fall back to `In-Reply-To`/`References` threading or a new conversation
   (the documented degradation, `conversation.email-channel.ts:275-295`). Acceptable given rare rotations.

## 5. Data model

### 5.1 Control DB — registry (`apps/control-tower/migrations/0001_registry.sql`)

Own lineage (`apps/control-tower/migrations/meta/_journal.json`, ledger `drizzle.__tower_migrations`), applied
by `apps/control-tower/scripts/migrate.ts`. Never in `packages/db`.

```sql
CREATE TYPE cp_workspace_state AS ENUM ('active','suspended','deleting');          -- vendor/contract.ts:65
CREATE TYPE cp_hostname_kind  AS ENUM ('system','platform','platform_redirect','custom'); -- contract.ts:67
CREATE TABLE cp_workspace_registry (
  workspace_key text PRIMARY KEY, contract_version integer NOT NULL,
  state cp_workspace_state NOT NULL DEFAULT 'active', state_reason text,
  primary_hostname text NOT NULL, base_url text NOT NULL,
  db_pooled_url text NOT NULL, db_direct_url text NOT NULL, db_name text NOT NULL, db_role text NOT NULL,
  db_credential_ref text NOT NULL, app_secrets_ref text NOT NULL,
  workspace_id text NOT NULL, fingerprint_stamped_at timestamptz NOT NULL,
  storage jsonb NOT NULL, email_from text NOT NULL, mail_slug text NOT NULL UNIQUE,
  ai_enabled boolean NOT NULL DEFAULT false, revision bigint NOT NULL DEFAULT 1,
  pg_database_oid bigint, pg_cluster_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cp_workspace_hostnames (
  hostname text PRIMARY KEY,
  workspace_key text NOT NULL REFERENCES cp_workspace_registry ON DELETE CASCADE,
  kind cp_hostname_kind NOT NULL, redirect_to_hostname text,
  CHECK ((kind = 'platform_redirect') = (redirect_to_hostname IS NOT NULL)));
CREATE INDEX ON cp_workspace_hostnames (workspace_key);
CREATE TABLE cp_workspace_activity (
  workspace_key text PRIMARY KEY REFERENCES cp_workspace_registry ON DELETE CASCADE,
  last_active_at timestamptz NOT NULL);                     -- upsert shape: activity.ts:144-146
-- revision bump (resolver.ts:8-10: "bumped by a database trigger on any change")
CREATE FUNCTION cp_bump_revision() ... BEFORE UPDATE ON cp_workspace_registry
  -> NEW.revision := OLD.revision + 1; NEW.updated_at := now();
CREATE FUNCTION cp_bump_parent_revision() ... AFTER INSERT/UPDATE/DELETE ON cp_workspace_hostnames
  -> UPDATE cp_workspace_registry SET revision = revision + 1 WHERE workspace_key = …;
```

Columns reproduce `RegistryRow` (`registry.ts:61-86`) and `SELECT_COLUMNS` (`:224-239`; `state::text`,
`kind::text` at `:275`), `toRecord` (`:436-462`), `listActiveWorkspaces` (`:322-347`).

`0002_schema_state.sql`: the CP fixture `fleet/__tests__/fixtures/0049_tenant_schema_state.sql` verbatim, then
the CP-0054 rename the upstream test reproduces (`schema-state.test.ts`): `cp_tenant_schema_state` →
`cp_workspace_schema_state`, `tenant_id` → `workspace_key`, FK retargeted. `status` stays `text + CHECK`.

Grants: `cp_reader` (web/worker): SELECT registry/hostnames, INSERT/UPDATE activity; `cp_migrator`: + RW
schema_state; `cp_provisioner`: RW all `cp_*` + SELECT `tower_users`, `tower_roles`, `tower_role_members`;
`cp_mail_router` (mail edge): column SELECT `(mail_slug, primary_hostname, state)`; `tower_app`: column SELECT
on registry (`workspace_key, state, state_reason, primary_hostname, base_url, revision`), SELECT
hostnames/activity, RW `tower_*`.

### 5.2 Control DB — tower (`0003_tower.sql`)

| Table                       | Columns                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tower_users`               | `id uuid pk`, `idp_subject text unique`, `email citext unique`, `name`, `status text check in (active,disabled)`, `last_login_at`, timestamps (replaces v2-r1 `tower_admins`)   |
| `tower_roles`               | `id uuid pk`, `key text unique`, `name`, `description`, `capabilities text[]` (⊆ code catalogue §6, checked on write), `tenant_template_key text null` (a `fork_role_templates.template_key` from 10; null ⇒ no custom role, e.g. Fleet Owner = legacy Admin), `tenant_legacy_role text check in (admin,member) default 'member'`, `is_seed bool`, timestamps |
| `tower_role_members`        | `user_id fk`, `role_id fk`, `source text check in (claim,manual)`, `granted_by uuid null`, `created_at`; pk (`user_id`,`role_id`,`source`) — multi-role (D-R4)                   |
| `tower_claim_role_mappings` | `id uuid pk`, `provider_id text` (tower SSO provider), `claim_path text` (OIDC claim or SAML attribute), `match text check in (equals,contains)`, `value text`, `role_id fk`, `enabled`, timestamps |
| `tower_tenant_clients`      | `workspace_key pk fk`, `client_id`, `client_secret_ct bytea`, `wrapped_dek`, `registered_at` (accepted, X-R6)                                                                   |
| `tower_tenant_grants`       | `id uuid pk`, `user_id fk`, `workspace_key fk`, `tenant_principal_id text`, `scopes text[]`, `refresh_token_ct bytea`, `access_token_ct bytea`, `access_expires_at`, `wrapped_dek bytea`, `kms_key_id`, `status text (active,needs_reconnect,revoked)`, `last_used_at`; unique (`user_id`,`workspace_key`) |
| `tower_connect_runs`        | `id uuid pk`, `user_id fk`, `queue jsonb` (ordered `[{key, status: pending|connected|failed|skipped, reason}]`), `created_at`, `completed_at`                                     |
| `tower_audit`               | `id uuid pk`, `user_id fk`, `user_email`, `workspace_key`, `tool text`, `args_digest`, `args_summary jsonb` (redacted), `target_ref`, `status (pending,ok,denied,error)`, `tenant_result jsonb`, `request_id`, `created_at`; indexes (`workspace_key`,`created_at`), (`user_id`,`created_at`); append-only except status transition via function. Role/membership/mapping edits are audited here too (`tool = 'tower.roles.*'`). |
| `tower_auth_*`              | Better Auth user/session/account/verification/sso_provider (generated shape, own lineage)                                                                                       |

PKCE verifiers for in-flight hops live in `tower_auth_verification` (Better Auth) or the tower session, keyed by
`state`. No tenant-DB tables are added by this plan; the provisioner writes `fork_settings` keys only
(`tower.oauth_client_id`, `tower.redirect_uri`, `tower.sso_provider_id`).

## 6. Permissions

**Tower capability catalogue** (code, `apps/control-tower/src/server/capabilities.ts`; each capability lists the
app OAuth scopes it needs):

| Capability                                     | App OAuth scopes                 |
| ---------------------------------------------- | -------------------------------- |
| `dashboard.view`, `roadmap.view`, `feedback.view`, `portfolio.view`, `changelog.view` | `read:feedback`        |
| `inbox.view`, `tickets.view`                   | `read:chat`                      |
| `feedback.act`, `roadmap.act`                  | `write:feedback`                 |
| `inbox.act`, `tickets.act`                     | `write:chat`                     |
| `changelog.publish`                            | `write:changelog`                |
| `announcements.view`, `announcements.publish`  | `write:feedback`                 |
| `apps.provision`, `apps.suspend`, `roles.manage`, `audit.view` | — (tower-only)   |

**Seed bundles** (`is_seed = true`, fully editable; more can be added — D-C9):

| Seed bundle        | Tower capabilities                                                                  | App role (`template_key` in 10)  |
| ------------------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| Fleet Owner        | all                                                                                 | legacy **Admin** (D-C5 🟡)        |
| Fleet Agent        | all `*.view`, `inbox.act`, `tickets.act`, `feedback.act`, `roadmap.act`, `announcements.publish` (D-N8) | "Fleet Agent" (D-C5 🟡) |
| Fleet Observer     | all `*.view`                                                                        | "Fleet Observer" (D-C5 🟡, D-R7)  |
| UX                 | `feedback.*`, `roadmap.*`, `portfolio.view`, `dashboard.view`                        | "UX Team"                        |
| Dev                | `feedback.view`, `roadmap.*`, `changelog.*`, `dashboard.view`                        | "Dev Team"                       |
| Stakeholder        | `dashboard.view`, `roadmap.view`, `portfolio.view`, `changelog.view`                 | "Stakeholder (read-only)"        |
| Tier 1/2/3 Agent   | `inbox.*`, `tickets.*`, `dashboard.view`                                            | "Tier N Agent" (team-scoped per 30) |

- **Tower enforcement:** a user's capabilities = union over their bundles; checked in `apps/control-tower`
  server handlers before any MCP call, and UI surfaces are hidden without the capability.
- **App enforcement (after D3):** each app enforces the custom role(s) `sync-members` assigned. Tower and app
  bundles are derived from the same `tower_roles` row, so they cannot drift apart except through manual edits
  to a template in one app (10's `sync template` repairs that). **Until D3 ships, MCP enforces only legacy role
  + scopes** (`tools/helpers.ts:219-251`); the scope union above is the interim guard. Phase 5 is gated on
  10-rbac Phase 1a.
- **New permission keys from this plan:** none. Fork MCP tools reuse existing keys and 60's `announcement.manage`.

## 7. Seams

| # | Upstream file | Change (one line) | Why unavoidable | Re-apply on conflict |
| - | ------------- | ----------------- | --------------- | -------------------- |
| IE-1 | `apps/web/src/lib/server/domains/conversation/conversation.email-channel.ts` (`signingKey`, `:243`) | `const forkKey = forkInboundAddressKey(); if (forkKey !== undefined) return forkKey` (`FORK-SEAM(inbound-email)`) + its import | The address key is read from process env in the one function both mint and verify use; no injection point exists. Permanently fork-only (D1). | Re-add as the first statement of whatever function returns the HMAC key for `signInboundTag`/`claimVerifies`. |
| C-1 (conditional, V-1) | `apps/web/src/lib/server/workspaces/pool-cache.ts` | `prepare: config.workspacePoolPrepare` at `:179`/`:402` (env `WORKSPACE_POOL_PREPARE`, default true) | Only if RDS Proxy pins on prepared statements. | Replace the two literals again. |
| shared | `mcp/tools/index.ts` | `registerForkTools` | **F-3**, not counted here. | — |
| dep | `packages/db/src/migrate-runtime.ts`; MCP actor construction | fork lineage; custom-role enforcement | **F-1** (Foundations) and R-3…R-5 (10-rbac); not counted here. | — |

**Count: 1 seam (+1 conditional).** Everything else is new files: `apps/control-tower/**`, `apps/mail-edge/**`,
`apps/web/src/lib/server/fork/{provisioner,inbound-email}/**`, `apps/web/src/routes/api/fork/tower-connect.ts`,
`apps/web/scripts/fork-provision.ts`, `apps/web/src/lib/server/mcp/tools/fork-fleet.ts`. Generated: `MATRIX.md`
(fork tools), `GRAPH.md`, `bun.lock`.

## 8. Phases

| Phase | Deliverable | Validation gate |
| ----- | ----------- | --------------- |
| **0. AWS spikes** | Shared Aurora cluster + RDS Proxy + fleet S3 bucket + 1 hand-made app | V-1 pinning measured (C-1 decision recorded); V-2 password auth; V-3 DSN/OID via proxy; V-7 S3 via `provider:'r2'` record; V-4 token TTLs + `skip_consent` behaviour |
| **1. Control DB** | `apps/control-tower/migrations` 0001–0003 + migrate script + grants | Registry parity test green; `apps/web` boots pooled against a hand-seeded row; `fleet-migrator status/enrol` work |
| **2. Provisioner** | `fork-provision create/verify/suspend/resume/deprovision/fork-migrate` | Two apps provisioned; `verify` passes (secrets, storage prefix, `skip_consent`); fingerprint refusals on a mis-wired row = 503 with the right code; `workspace-probe` isolation passes; mail slug > 13 chars refused |
| **3. App SSO + members** | IdP rows (OIDC direct or via broker), `sync-members` with bundles + multi-role, `tower-connect` route | User signs into both apps via the IdP and lands on the seeded principal (no duplicate user); user with two bundles holds both app roles; removing a bundle removes only that tower-managed assignment; disabled user loses access; `tower-connect` rejects a foreign `client_id`/`redirect_uri` |
| **4. Tower shell** | Better Auth + SSO plugin (OIDC and SAML), `tower_roles`/members/claim mappings + roles UI, silent "connect all", grants (KMS), `tower_audit` | Sign-in via an OIDC IdP and via a SAML IdP; claim-mapped roles applied, unknown subject refused; connect-all across 2 apps with **no consent screen and no click**; one app down → skipped, chain continues; identity mismatch → revoked; token refresh + `needs_reconnect`; tower task has no root-key/DSN access (IAM policy test) |
| **5. Read + act** (after 10-rbac 1a) | `fork-fleet.ts` tools, unified inbox/tickets/feedback/roadmap/changelog/dashboard, actions | One app down → partial result; dormant app skipped; reply in A + status change in B from one screen; `tower_audit` + app activity both name the human; Fleet Observer write via MCP denied by the app; capability hidden in UI and refused server-side |
| **6. Announcements** (after 60) | Tower announcements page over `fork-announcements.ts` | Fleet Owner **and** Fleet Agent publish to 2 apps; per-app result; bundle without `announcements.publish` cannot |
| **7. Portfolio** (after 50) | Read-only cross-app prioritization views | Scores match app UI; no write path |
| **8. Per-app inbound email** (after Phase 2; parallel to 3–7) | `fork/inbound-email/address-key.ts`, seam IE-1, `apps/mail-edge` (SES + Lambda + DLQ), `cp_mail_router` grant | Reply to app A's address lands in A; an address minted in A, re-slugged to B, fails verification in B; A's key ≠ B's key; single-tenant install unchanged (env key); unknown slug bounces; edge signature matches the upstream contract test vectors |
| **9. Ops hardening** | Deploy runbook (`fleet-migrator run` → `fork-migrate`), cluster backup/PITR + restore drill (D-C8), rate limits, alarms | Upgrade rehearsal: merge upstream, migrate fleet, probe + tower e2e + inbound email e2e green |

## 9. Testing

- **Registry parity** (`apps/web/src/lib/server/fork/control-plane/__tests__/registry-ddl.test.ts`): scratch DB
  from `apps/control-tower/migrations/*.sql`; run the real `listActiveWorkspaces`, `resolveWorkspaceByHostname`,
  `resolveWorkspaceById` against a provisioned-shape row (fleet-bucket storage, no `credentialRef`) → `kind: 'ok'`;
  assert every `SELECT_COLUMNS` identifier exists; revision bumps; `schema-state.ts` claim/complete.
- **Provisioner integration:** scratch Postgres; `withWorkspaceScopeById` passes; negative cases (canary under
  wrong key, stamp for another key); `sync-members` idempotence and multi-role add/remove.
- **Inbound email (fork `__tests__`):** mint/verify round-trip under two scoped workspaces with distinct keys;
  cross-workspace forgery refused; `forkInboundAddressKey()` returns `undefined` when not pooled and `null`
  unscoped; seam present (grep test on `FORK-SEAM(inbound-email)`); mail-edge slug normalisation parity with
  `workspaceSlugFromInboundAddress`.
- **tower-connect route:** open-redirect cases (foreign host, foreign `client_id`, foreign `redirect_uri`),
  session-present shortcut, failure bounce to the tower.
- **MCP fork tools:** per-tool scope, teamOnly, D3 permission denial; authz-matrix snapshot regenerated.
- **Tower:** capability union from multiple bundles; claim mapping (OIDC claim, SAML attribute); fan-out
  (timeouts, partials, cursor merge); grant crypto (KMS mocked); e2e with two apps and a Keycloak container
  acting as OIDC IdP and as SAML IdP (plus broker) covering connect-all → act → dual audit.
- **Isolation:** `apps/web/workspace-probe/` after every tenancy change and upstream sync.

## 10. Open items

- **D-C5 (🟡)** Confirm the seed mapping: Fleet Owner → app Admin; Fleet Agent → "Fleet Agent"; Fleet Observer
  → "Fleet Observer". Seeds are editable bundles, so this only fixes the defaults.
- **O-2 (new)** D-C7 says every app supports OIDC **and** SAML. Upstream `apps/web` is OIDC-only; this plan
  meets SAML for apps through an OIDC broker (zero seams) rather than native SAML in `apps/web` (several auth
  seams). Owner to confirm the broker is acceptable.
- **O-3 (new)** D-C11 is met by per-app **address** keys (IE-1). The edge→app key `INBOUND_HMAC_SECRET` stays
  fleet-wide (slug-bound, so not re-aimable). Making it per-app too would require the edge to hold per-app
  keys. Confirm fleet-wide edge key is acceptable.

## 11. Relationship to other v2 plans

- **10-rbac:** hard dependency. Phase 1a (D3) makes app roles bind over MCP; 10 defines the tenant templates
  every bundle names ("UX Team", "Dev Team", "Stakeholder (read-only)", "Tier 1/2/3 Agent", "Fleet Agent",
  "Fleet Observer"), `fork_role_templates` (lookup by `template_key`), `ensurePersonaRoles` / MCP tool
  `fork_install_persona_roles`. Fleet Agent template must include `announcement.manage` (D-N8).
- **30-tiered:** Tier bundles assign tier roles through 30's team-scoped mechanism (tier = team membership,
  D-A8). Tier escalation and account actions are not exposed in the tower in v2.
- **50-prioritization:** score exposure + `fork-prioritization.ts` for Phase 7.
- **60-announcements:** `fork_announcements`, `announcement.manage`, `fork-announcements.ts`
  (`list_/upsert_/archive_announcement`, `broadcastId` idempotency); the tower is a client (Phase 6).
- **Foundations:** F-1 (fork lineage), F-3 (MCP registration), `fork_settings`, `fork-migrate` (02 §3.3).
