# RBAC Persona Extensions — v2 Plan

> **Status:** v2 (round-2 revision) — supersedes `plans/v1/rbac-persona-extensions-plan.md`. Nothing here is
> implemented.
> **Depends on:** Foundations (fork migration lineage `packages/db/drizzle-fork` + `drizzle.__fork_migrations`,
> `fork_settings`, shared seams F-1…F-7, `plans/v2/SEAMS.md`) — see `02-fork-conventions.md`.
> **Decisions applied:** D1, D3, D4, D-R1…D-R9, D-T4, D-T7, D-A3, D-A4, D-A6, D-A8, D-P6, D-N8, D-C5 (🟡),
> D-C9.
> **Baseline:** upstream `780a7b577` (fork `main` has no `apps/`/`packages/` diff against it). Every
> `file:line` below was verified against that tree.

## 0. Round-2 changes

| Change | Driven by |
| --- | --- |
| Custom-roles-on-REST/MCP fix is a **permanent fork patch**; not offered upstream. R-1…R-5 are permanent seams. | D1, D3 (Q18) |
| Seat-exempt Phase 4, seam R-7 (`seat-usage.ts`) and the `seat_exempt` column **removed**. | D-R1, D4 |
| `fork_role_flags` → **`fork_role_templates`** (template identity only; still needed because custom roles have no semantic key, `role.service.ts:262-263`). | D-R1 |
| Phase 3 multi-role is **in scope** (no longer deferrable). | D-R4 |
| Board-scoped teammates **out of scope** (not an open item). | D-R5 |
| Phase 1b teammate comment gate **in scope** on dashboard, REST and MCP; one-time `comment.create` grant to existing custom roles. New seam **R-8** (REST comment route). | D-R6 |
| Eight persona templates defined (UX Team, Dev Team, Stakeholder (read-only), Tier 1/2/3 Agent, Fleet Agent, Fleet Observer). | D-R3, D-C9, D-P6, D-A8, D-N8 |
| `account.unlock` / `account.create` replaced by generic **`account.execute`**; tier gating is by `min_tier` in 40. | D-A6, D-A8 |
| `ticket.escalate` granted to Manager; `prioritization.manage` moved to admin-only; `prioritization.score` removed from Manager. | D-T7, D-P6 |
| `TEAM_SCOPABLE_PERMISSIONS` = `ticket.escalate`, `account.request`, `account.execute`. | D-A6, D-T4 |
| New §4.7: tower role bundles → tenant templates. | D-C9 |
| Settings nav entry and catalogue edits now satisfied by shared F-4 / F-7 (not counted here). | 02 §10 |

## 1. Changes from v1

| # | v1 issue (review §3.6, X4, X5, X7, cross-plan §4) | v2 resolution |
| --- | --- | --- |
| 1 | "Adding a key = `bun run db:permissions`" — wrong. That script only regenerates the client mirror `apps/web/src/lib/shared/permissions.ts`. | DB side reconciles via `seedSystemData` (`packages/db/src/seed-system.ts:47-102`), invoked from `runMigrations` (`packages/db/src/migrate-runtime.ts:271`). Both steps are in the Phase 1 gate. |
| 2 | v1 Phase 4 `viewer` legacy role "a small schema/enum addition". | **Dropped entirely** (D-R1, D4 — seat limits never apply). Read-only is expressed by bundles + Phase 1a/1b; no seat mechanics. |
| 3 | "`teamId` is unused, just read it in `permissionsForPrincipal`". | `teamId` is actively excluded with `isNull(teamId)` in 6 places (`policy/permissions.ts:70`, `domains/roles/role.service.ts:98,184,460`, `domains/principals/principal.factory.ts:369`, `functions/settings.ts:178`). v2 **keeps all 6 filters** and adds a fork-only team resolver (§4.4, D-R9). |
| 4 | "Multi-role: stop replace-all" (edit the writer). | The writer `reconcileWorkspaceAssignment` (`principal.factory.ts:357-398`) deletes all workspace rows on every role change. v2 does **not** edit it; extra hats are fork-written rows with documented reset semantics (§4.5). |
| 5 | **X5 — custom roles not enforced on REST/MCP** (not in v1). | **Phase 1a** (D3): REST and MCP resolve the principal's custom-role set ∩ scopes; a fork tool→permission map gates MCP tools. **Permanent fork patch** (D1/Q18). |
| 6 | **X4 — new keys auto-granted to Manager** (`rbac-catalogue.ts:644-649`). | Explicit per-key table (§6); keys Manager must not hold go into the fenced `WORKSPACE_ADMIN_PERMISSIONS` block (F-7). |
| 7 | **X7 / D-R2 — 3-part keys.** | Two-part only; `scopeForPermission` reads `split('.')[1]` (`lib/shared/api-key-scopes.ts:251`). Existing categories only, so `CATEGORY_SCOPES` (`api-key-scopes.ts:211-227`) is untouched. |
| 8 | Contributor assumed a good tier base. | Contributor has `conversation.*` but **no `ticket.*`** (`rbac-catalogue.ts:653-693`). Tier/Fleet templates list `ticket.*` keys explicitly. |
| 9 | `comment.create` gate "+ enforce". | `createCommentFn` is a bare `requireAuth()` shared with portal users (`functions/comments.ts:116-125`); widget reuses `runCreateComment` (`functions/widget/comments.ts:8-9`). Gate applies to **teammates only**, on dashboard (R-6), REST (R-8) and MCP (tool map) — in scope per D-R6. |
| 10 | `post.view` read key. | **Dropped** — admin feedback inbox already gates on `post.view_private` (`functions/admin.ts:151`). |
| 11 | `roadmap.view` / board-scoped teammates. | **Out of scope** (D-R5). Teammates keep the `isTeamActor` bypass (`policy/boards.ts:54`, `policy/roadmaps.ts:13`). |
| 12 | `domains/*/portal-invites`. | Irrelevant now: all personas are dashboard teammates (D-R3). |
| 13 | Upgrade-safety "localized". | Own seams (§7): **7 upstream files**, all small fenced edits; catalogue + nav via shared F-7/F-4. |
| 14 | Cross-plan keys missing. | §6 is the single registry of all fork keys; §4.2 defines all eight templates. |
| 15 | Fleet `viewer` vs tenant terminology. | No tenant `viewer`; fleet `observer` → **"Fleet Observer"** (D-C5), generalised by configurable tower bundles (D-C9, §4.7). |
| 16 | API keys ignored. | Every key mints a service principal whose legacy role = creator's (`domains/api-keys/api-key.service.ts:106-137`); §4.3 defines key authority for custom-role creators (D-R8). |

## 2. Requirements

- **R1** Personas (UX Team, Dev Team, Stakeholder (read-only), Tier 1/2/3 Agent, Fleet Agent, Fleet Observer)
  are custom roles installable as templates without hand-picking keys (D-R3). All are dashboard teammates.
- **R2** A custom role's bundle is the authority on **every** surface: dashboard, REST API, MCP (OAuth and
  API key). No path falls back to the legacy Manager/Owner preset for a custom-role holder (D3).
- **R3** Fork keys exist with an explicit, reviewed default per system role.
- **R4** Some grants apply only within a team (tier teams) — prerequisite for 30/40 (D-T4).
- **R5** A person can hold more than one role (e.g. Dev Team + Tier 2) (D-R4).
- **R6** Read-only teammates cannot comment on any surface (D-R6); existing custom-role holders keep commenting.
- **R7** Upgrade-safe: no upstream schema edits, no new legacy role, no seat mechanics (D4), minimal seams.

## 3. How it works today (verified)

- Two axes: legacy `principal.role` (`admin|member|user`, text column, `schema/auth.ts:821-823`) is the
  teammate wall; permission bundles live in `principal_role_assignments` (`schema/rbac.ts:62-97`). Custom
  roles ride legacy `member`; custom roles get `key = id` ("Customs have no semantic key",
  `role.service.ts:262-263`).
- Resolution: `permissionsForPrincipal` (`policy/permissions.ts:58-76`) unions **workspace-wide** rows,
  falls back to the legacy preset when none. Dashboard gates resolve it (`functions/auth-helpers.ts:153`);
  non-dashboard audiences carry an empty set (`auth-helpers.ts:158-160`). `can()` uses `actor.permissions` or
  falls back to the legacy role (`policy/authorize.ts:21-23`).
- **Gap (X5):** REST uses `resolveActorPermissions(auth.role)` — legacy preset only
  (`domains/api/auth.ts:134,158`). MCP contexts carry only `role` (`mcp/types.ts:16-31`,
  `mcp/handler.ts:98-128,183-200`); MCP actors carry no permission set (`mcp/tools/helpers.ts:230-252`); tools
  gate on scope + `teamOnly` (`helpers.ts:171-197`), and some handlers call services with no permission check
  (e.g. `get_ticket`, `mcp/tools/tickets.ts:149-175`). A custom-role holder on MCP therefore acts as **Manager**.
- Keys: `createApiKey` mints a service principal with `role = isAdmin(creator) ? 'admin' : 'member'`
  (`api-key.service.ts:125-137`); service principals get **no** assignment rows (`principal.factory.ts:186-200`).
  `api_keys.created_by_id` is `ON DELETE SET NULL` (`schema/api-keys.ts:28-31`).
- Comments: all creation funnels through `createComment` (`domains/comments/comment.service.ts:42`), called
  from `runCreateComment` (`functions/comments.ts:89`; dashboard, portal, widget), REST
  (`routes/api/v1/posts/$postId.comments.ts:164`, gated `comment.moderate` at `:74`), MCP `add_comment`
  (`mcp/tools/comments.ts:107`, scope only) and conversation→post convert (`conversation.convert.ts:60`, a
  private tracking note written by an agent already authorised to convert).
- `prioritization.manage` exists (RESERVED, category `feedback`, `rbac-catalogue.ts:81,407-410`) and is **not**
  in `WORKSPACE_ADMIN_PERMISSIONS` (`:613-642`), so Manager holds it today.

## 4. Design

### 4.1 Fork catalogue block (Phase 1, via shared seam F-7)

Fork keys live in `packages/db/src/fork/rbac-catalogue.fork.ts` (exports `FORK_PERMISSIONS`,
`FORK_PERMISSION_CATALOGUE`, `FORK_WORKSPACE_ADMIN_PERMISSIONS`, `FORK_CONTRIBUTOR_PERMISSIONS`; type-only import
of `PermissionCategory`). F-7 spreads them into `PERMISSIONS` (keeps `as const` typing),
`PERMISSION_CATALOGUE`, `WORKSPACE_ADMIN_PERMISSIONS` and the `contributor` array. `FORK_WORKSPACE_ADMIN_PERMISSIONS`
may list the **existing** key `prioritization.manage` (D-P6); it is not re-declared in the catalogue. Then
`bun run db:permissions`; `seedSystemData` inserts rows and reconciles the four presets on the next migrate.

### 4.2 Persona role templates (Phase 0, extended in Phase 1)

- Fork module `apps/web/src/lib/server/fork/rbac/persona-templates.ts`: pure data
  `{ templateKey, name, description, keys[], teamScopedKeys[] }`. `teamScopedKeys` are the
  `TEAM_SCOPABLE_PERMISSIONS` the template expects to be granted **team-scoped** (§4.4).
- `installPersonaRolesFn({ templateKeys? })` (`fork/rbac/functions.ts`, `requireAuth({ permission: 'role.manage' })`)
  calls upstream `createRole` with explicit `permissionKeys` (reusing ceiling, tier cap and `role.created`
  audit), then writes `fork_role_templates(role_id, template_key)`. Idempotent per template (skip if a row
  exists; cascade-deleted with the role, so a deleted template can be reinstalled).
- `syncPersonaTemplateFn` adds template keys missing from an installed role (never removes) — how Phase 1
  keys reach roles installed in Phase 0 (custom roles never auto-gain keys).
- Pure service `ensurePersonaRoles(installer, templateKeys)` + fork MCP tool `fork_install_persona_roles`
  (`mcp/tools/fork-rbac.ts`, registered via F-3) so the tower installs roles per tenant (§4.7, 20).
- Not seeded on migrate: installation is an explicit, audited admin action (ceiling applies).

Bundles (✱ = fork key; **T** = team-scoped grant on the tier team, §4.4; tier bundles are starting points —
30/40 own final tier semantics):

| Template | Bundle |
| --- | --- |
| **UX Team** | `post.view_private`, `post.create`, `post.set_status`, `post.set_tags`, `post.merge`, `status.view`, `tag.view`, `suggestion.view`, `member.view`, `segment.view`, `analytics.view`, `changelog.view_draft`, ✱`comment.create`, ✱`prioritization.score`, `prioritization.manage` (D-P6) |
| **Dev Team** | Feedback triage/status: `post.view_private`, `post.create`, `post.set_status`, `post.set_board`, `post.set_tags`, `post.set_owner`, `post.merge`, `status.view`, `tag.view`, `suggestion.view`, `suggestion.manage`, `member.view`; roadmap: `roadmap.manage`; changelog: `changelog.view_draft`, `changelog.manage` (🟡, see O3); ✱`comment.create`. No `prioritization.*`. |
| **Stakeholder (read-only)** | View keys only: `post.view_private`, `changelog.view_draft`, `status.view`, `tag.view`, `member.view`, `analytics.view`. **No** ✱`comment.create` (D-R6). |
| **Tier 1 Agent** | `conversation.view/reply/note/set_status/set_tags`, `ticket.view/reply/note/set_status`, `people.view`, `company.view`, `member.view`, `tag.view`, `integration.view`, `copilot.use`, ✱`account.request`, ✱`account.execute`; **T** ✱`ticket.escalate`, ✱`account.request`, ✱`account.execute` |
| **Tier 2 Agent** | Tier 1 + `conversation.assign`, `ticket.assign`, `ticket.create` (roll-up, D-A8) |
| **Tier 3 Agent** | Tier 2 + `conversation.view_all`, `ticket.view_all` |
| **Fleet Agent** (D-C5) | Contributor preset (incl. ✱`comment.create` via the fenced contributor list) + `ticket.view/reply/note/assign/set_status/create` + ✱`announcement.manage` (D-N8) |
| **Fleet Observer** (D-C5, D-R7) | Read-only: `post.view_private`, `conversation.view`, `conversation.view_all`, `ticket.view`, `ticket.view_all`, `people.view`, `company.view`, `member.view`, `segment.view`, `status.view`, `tag.view`, `suggestion.view`, `changelog.view_draft`, `analytics.view`, `integration.view`. No ✱`comment.create`. |

- **Tier keys:** every tier holds `account.request` **and** `account.execute`; what an agent may run or approve
  is decided by the action's `min_tier` against the agent's effective tier (highest tier team they belong to,
  D-A8) in 40 — not by the key. Tier 3 keeps `ticket.escalate` by roll-up; 30 treats T3 as having no target.
- No new read keys: every read a read-only persona needs already exists as a `*.view*` key (`READ_VERBS`,
  `api-key-scopes.ts:234`). Genuine read-only comes from Phase 1a (MCP tool map requires the key) + Phase 1b.
- Known non-gated interactions for read-only teammates (upstream, not comments): own votes and reactions
  (`runAddReaction`, `functions/comments.ts:127-154`, bare `requireAuth`) — see O4.

### 4.3 Phase 1a — custom-role enforcement on REST and MCP (D3, permanent fork patch)

**Principle:** authority = *principal's resolved permission set* ∩ *credential scopes*, on every surface.
Not offered upstream (D1/Q18); R-1…R-5 are carried permanently and re-applied at every sync.

1. **REST** (`domains/api/auth.ts`, R-1): `requireApiKey` resolves
   `permissions = await permissionsForPrincipal(apiKey.principalId, role)` once and stores it on
   `ApiAuthContext`; lines 134 and 158 read `auth.permissions` instead of `resolveActorPermissions(auth.role)`.
   No assignment rows → same legacy preset as today → zero change for existing keys.
2. **API-key authority for custom-role creators** (R-2): the service principal receives a **copy of the
   creator's workspace-wide role assignments** at creation (hook after `createServicePrincipal`,
   `api-key.service.ts:133-137`). Role edits propagate; the key survives creator removal; the creator's
   ceiling bounds it. Rejected: "creator's live set ∩ scopes" (extra query, undefined once `created_by_id`
   is nulled).
   - **Existing keys (D-R8):** `backfillKeyAuthorityFn` (`api_key.manage`): dry-run report of each key whose
     creator holds non-preset assignments and what it would lose; explicit apply. Recorded in
     `fork_settings['rbac.key_backfill']`.
   - Side-effect: service principals count in role holder counts (`role.service.ts:98,184`) and move on
     delete-with-reassign (`:460`) — noted in the UI.
3. **MCP context** (`mcp/types.ts`, R-3): optional `permissions?: ReadonlySet<PermissionKey>`. At the single
   consumer (`mcp/handler.ts:240`, after `resolveAuthContext`, R-4) call fork `resolveMcpPermissions(auth)` =
   `permissionsWithinScopes(await permissionsForPrincipal(principalId, role), new Set(scopes))`
   (`api-key-scopes.ts:319-325`). Covers OAuth (`handler.ts:98-128`) and API keys.
4. **MCP actors** (`helpers.ts:230-252`, R-5): both builders add `permissions: auth.permissions`.
5. **MCP tool gate** (R-5): `registerTool` (`helpers.ts:171`) calls fork `forkMcpToolGate(auth, def.name)` after
   the `teamOnly` guard, using `FORK_MCP_TOOL_PERMISSIONS` (`fork/rbac/mcp-tool-permissions.ts`:
   `toolName → key | key[] (any-of) | 'dispatch'`), for team-role callers only. Examples: `get_ticket →
   ticket.view`, `list_conversations → conversation.view`, `add_comment → comment.create` (Phase 1b).
   **Unmapped tool = deny for team callers** + a CI test over `scanAllMcpTools`
   (`policy/authz-matrix/scan.ts:321`) that fails on any unmapped tool, so every upstream MCP tool addition
   forces an explicit fork decision at merge time.
6. Not fixed (non-security): `functions/admin.ts:397` onboarding checklist uses `permissionsForLegacyRole` (O5).

### 4.4 Phase 2 — team-scoped RBAC (prerequisite for 30/40, D-T4, D-R9)

- **Storage:** upstream's reserved `principal_role_assignments.team_id` (FK → `teams.id` ON DELETE CASCADE,
  `schema/rbac.ts:86-91`). No fork DDL. The partial unique index exempts `team_id IS NOT NULL` (`:92-95`), so
  the fork writer dedupes under `pg_advisory_xact_lock` + existence check.
- **Isolation:** all 6 upstream `isNull(teamId)` filters stay, so team-scoped rows are invisible to every
  upstream check. Merge checklist: watch for removal of those filters (D-R9).
- **`TEAM_SCOPABLE_PERMISSIONS`** = `ticket.escalate`, `account.request`, `account.execute` — checked only in
  fork code (30/40), always through `canInTeam`, never `can()` (fork lint test).
- **Resolver** (`fork/rbac/team-permissions.ts`): `teamPermissionsForPrincipal(principalId)` →
  `Map<TeamId, Set<PermissionKey>>`, counting a row only if the principal is a teammate (`isTeamMember(role)`)
  **and** in `team_members` for that team (`schema/teams.ts:71`).
  `canInTeam(actor, key, teamId, scopes?)` = *system-role grant* (Owner/Admin preset; Manager for
  `ticket.escalate`, D-T7) **or** `teamSet(teamId).has(key)`, intersected with MCP/key scopes. A scopable key
  reaching a person only through a **workspace-wide custom-role** assignment is inert (flagged in the UI) — so a
  Tier role can be assigned workspace-wide for its dashboard keys without its scopable keys leaking beyond the
  tier team.
- **Tier assignment** = one fork action `assignTierAgentFn(principal, tierTeam)` (`member.manage`): workspace-wide
  assignment of the Tier N role (dashboard keys) + team-scoped grant of the same role on the tier team
  (scopable keys). Effective tier / roll-up is computed by 30/40 from tier-team membership (D-A8).
- **Writer:** `grantTeamRoleFn` / `revokeTeamRoleFn` (`member.manage` + `assertGrantableRole`,
  `domains/roles/role.grants.ts:22-38`). Audit via `user.role.changed` (`audit/log.ts:68`) with metadata
  `{ scope: 'team', teamId, roleId, op }`. A role with no scopable keys is rejected for team-scoped assignment.
- **Upstream interactions (accepted):** role delete ignores team-scoped holders in its in-use check and
  cascades them (`role.service.ts:405+`) — the fork page lists them before delete; demotion to `user` leaves
  rows inert.

### 4.5 Phase 3 — multi-role assignment (in scope, D-R4)

- `addRoleAssignmentFn` / `removeRoleAssignmentFn` (fork, `member.manage` + ceiling) insert/delete extra
  workspace-wide rows (`team_id IS NULL`, protected by the existing partial unique index). Resolution already
  unions (`permissions.ts:74-75`). Refuses the last remaining row (use upstream role change) and the Owner preset.
- **Reset semantics (documented, not patched):** any upstream role change calls `reconcileWorkspaceAssignment`,
  which deletes **all** workspace rows (`principal.factory.ts:364-371`) — extra hats are cleared (team-scoped
  rows are untouched: that delete filters `isNull(teamId)`, `:369`). Same-role saves do not reconcile
  (`:325-334`). The fork page shows "additional roles"; upstream's members table (`functions/settings.ts:165-185`)
  keeps showing one — acceptable.

### 4.6 Phase 1b — teammate comment gate (in scope, D-R6)

- **Key:** `comment.create` (fork, category `feedback`). Owner/Admin/Manager hold it by construction;
  Contributor via the fenced contributor list; templates as §4.2.
- **Dashboard / portal / widget (R-6):** first line of `runCreateComment` (`functions/comments.ts:65`):
  `await forkAssertTeammateMayComment(auth)`. Applies only when the **principal record's** legacy role is
  `admin|member` (portal users untouched); resolves `permissionsForPrincipal` itself because non-dashboard
  audiences carry an empty set (`auth-helpers.ts:158-160`) — so a read-only teammate cannot comment from the
  portal or widget either.
- **REST (R-8):** after `withApiKeyAuth(…, COMMENT_MODERATE)` (`$postId.comments.ts:74`):
  `assertApiPermissions(auth, [PERMISSIONS.COMMENT_CREATE])` — upstream's own helper (`domains/api/auth.ts:154-167`),
  which reads the R-1 resolved set. Same `write:feedback` scope as today; legacy keys unaffected (all presets hold
  the key).
- **MCP:** `add_comment → comment.create` in the R-5 tool map; no extra seam.
- **Not gated:** `conversation.convert.ts:60` (tracking note written as part of a conversion the agent is already
  authorised for).
- **Rollout:** `enableTeammateCommentGateFn` (`role.manage`) first runs a one-time, idempotent grant of
  `comment.create` to **every existing non-system role** (`roles.is_system = false`, `schema/rbac.ts:34`) that
  lacks it — **except** installed templates whose bundle omits it (Stakeholder (read-only), Fleet Observer) —
  then sets `fork_settings['rbac.teammate_comment_gate'] = true` in the same transaction. Report stored in
  `fork_settings['rbac.comment_create_backfill']`. Roles created afterwards get the key only if chosen
  (catalogue keys default-off for custom roles, `role.service.ts:22-24`).

### 4.7 Tower role bundles → tenant templates (D-C9; detail in 20)

- Tower authorization is **configurable role bundles**; `observer`/`agent`/`owner` are only seeds (D-C9). Each
  bundle carries its tower capabilities **and** a tenant role target: `admin` (legacy Admin, seed `owner`) or a
  **`template_key`** from §4.2 (seeds: `agent → fleet_agent`, `observer → fleet_observer`, D-C5 🟡).
- At provisioning / bundle change, the tower calls `fork_install_persona_roles({ templateKeys })` in each
  tenant, then assigns the resolved `role_id` (looked up via `fork_role_templates`) through upstream member
  role change or Phase 3 extra-hat assignment. Tier roles additionally need `assignTierAgentFn` (tier team).
- Tenant keys are always enforced by the tenant (Phase 1a); tower capabilities are enforced by the tower.
  Bundle storage, UI and the capability list live in `20-control-tower.md`.

## 5. Data model (fork lineage)

`packages/db/drizzle-fork/00NN_fork_role_templates.sql` + schema `packages/db/src/fork/schema/rbac.ts`:

| Column | Type | Notes |
| --- | --- | --- |
| `role_id` | `typeIdColumn('role')` **PK** | FK → `roles.id` ON DELETE CASCADE |
| `template_key` | text not null, **unique** | `ux_team`, `dev_team`, `stakeholder_readonly`, `tier1_agent`, `tier2_agent`, `tier3_agent`, `fleet_agent`, `fleet_observer` |
| `installed_at` | timestamptz not null default now() | |
| `installed_by_principal_id` | `typeIdColumnNullable('principal')` | FK → `principal.id` ON DELETE SET NULL; staff-only → exemption in the fork re-point registry (02 §8, F-5) |

- No other DDL: team-scoped and multi-role rows use existing `principal_role_assignments` columns.
- `fork_settings` keys: `rbac.key_backfill`, `rbac.teammate_comment_gate`, `rbac.comment_create_backfill`,
  `rbac.team_scoped_enabled`, `rbac.multi_role_enabled` (Phase 1a is never gated — it is a fix).

## 6. Permissions

Registry of **all fork keys** (shared names) — every other v2 plan references this table. Owner/Admin hold
every key by construction (`rbac-catalogue.ts:645-646`).

| Key | Category (→ scope) | Manager | Contributor | Templates | Enforced in | Plan |
| --- | --- | --- | --- | --- | --- | --- |
| `prioritization.score` (new) | feedback (`write:feedback`) | ✗ (fenced admin block) | ✗ | UX Team | fork scoring fns / MCP | 50 |
| `prioritization.manage` (existing, RESERVED) | feedback | ✗ (**moved** into fenced admin block, D-P6) | ✗ | UX Team | framework config | 50 |
| `ticket.escalate` (new) | support (`write:chat`) | ✓ (D-T7) | ✗ | Tier 1/2/3 (**T**) | `canInTeam` in escalation | 30 |
| `account.request` (new) | support (`write:chat`) | ✗ (fenced admin block, D-A4) | ✗ | Tier 1/2/3 (+ **T**) | `canInTeam` | 40 |
| `account.execute` (new; replaces `account.unlock`/`account.create`, D-A6) | support (`write:chat`) | ✗ (fenced admin block, D-A4) | ✗ | Tier 1/2/3 (+ **T**) | `canInTeam` + action `min_tier` vs effective tier (D-A8) | 40 |
| `announcement.manage` (new) | status_page | ✓ | ✗ | Fleet Agent (D-N8) | fork announcement fns / MCP | 60 |
| `comment.create` (new) | feedback (`write:feedback`) | ✓ | ✓ (fenced contributor list) | UX, Dev, Fleet Agent (not Stakeholder, Fleet Observer) | R-6, R-8, MCP `add_comment` | 10 |

- `FORK_WORKSPACE_ADMIN_PERMISSIONS` = `prioritization.score`, `prioritization.manage`, `account.request`,
  `account.execute`. `ticket.escalate` and `announcement.manage` are deliberately **not** in it (Manager ✓).
- Fork server functions gate `requireAuth({ permission })`: `role.manage` (templates, comment-gate enable),
  `member.manage` (team / multi-role / tier assignment), `api_key.manage` (key backfill). Regenerate `MATRIX.md`.

## 7. Seams (own; catalogue = F-7, settings page = F-4, MCP registration = F-3)

| # | Upstream file | Change (one-liner) | Why unavoidable | Re-apply on conflict |
| --- | --- | --- | --- | --- |
| R-1 | `apps/web/src/lib/server/domains/api/auth.ts` | Resolve `permissionsForPrincipal` in `requireApiKey`; read `auth.permissions` at :134/:158 | REST authority is decided here (X5) | Re-apply 3 marked edits; test "custom-role key denied" |
| R-2 | `apps/web/src/lib/server/domains/api-keys/api-key.service.ts` | After `createServicePrincipal`: `await forkCopyCreatorAssignments(createdById, sp.id)` | Only point where creator and key principal are both known | Re-insert after the service-principal create |
| R-3 | `apps/web/src/lib/server/mcp/types.ts` | `permissions?: ReadonlySet<PermissionKey>` on `McpAuthContext` | Context must carry the set to tools | Re-add field |
| R-4 | `apps/web/src/lib/server/mcp/handler.ts` | After `resolveAuthContext` (:240): `auth.permissions = await resolveMcpPermissions(auth)` | Single consumer of all context shapes | Re-insert after the call |
| R-5 | `apps/web/src/lib/server/mcp/tools/helpers.ts` | Actors: `permissions: auth.permissions`; `registerTool`: `forkMcpToolGate(auth, def.name)` | Tool guard + actor construction live here | Re-apply 3 marked lines; run MCP coverage test |
| R-6 | `apps/web/src/lib/server/functions/comments.ts` | First line of `runCreateComment`: `await forkAssertTeammateMayComment(auth)` | Dashboard/portal/widget comment create has no permission gate | Re-insert first line of fn |
| R-8 | `apps/web/src/routes/api/v1/posts/$postId.comments.ts` | After `withApiKeyAuth` in POST (:74): `assertApiPermissions(auth, [PERMISSIONS.COMMENT_CREATE])` | REST comment create gates only `comment.moderate` | Re-insert after the auth line (3 commits / 90 days) |

**Total: 7 own seam files, all permanent** (R-1…R-5 = Phase 1a, D3; R-6/R-8 = Phase 1b, D-R6). **R-7
(`seat-usage.ts`) retired** (D-R1). Not seams: fork route `routes/admin/settings.fork-access.tsx` (via F-4),
`mcp/tools/fork-rbac.ts` (via F-3), fork migration, `MATRIX.md` / mirror regeneration.

## 8. Phases and validation gates

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **0** Persona templates | `fork_role_templates` migration; 8 templates (existing keys only); install fn + fork settings page | Install twice → one role per template; installer lacking a key → ceiling error. **Ship with 1a** — before 1a, templates do not bind on MCP/REST. |
| **1a** Custom-role enforcement | R-1…R-5; key backfill dry-run/apply; tool map + coverage test | Tier 1 holder via MCP OAuth cannot `get_ticket` without `ticket.view` or call a Manager-only service; key created by a custom-role creator denied a key outside its role; legacy Owner/Manager keys unchanged (golden REST suite green); every MCP tool mapped |
| **1** Fork keys | F-7 block; §6 keys; `bun run db:permissions`; template sync | `seedSystemData` inserts rows; Manager holds `ticket.escalate`/`announcement.manage`/`comment.create`, lacks `account.*`/`prioritization.*`; `MATRIX.md` regenerated; `scopeForPermission` maps as §6 |
| **1b** Comment gate | R-6, R-8; `add_comment` mapping; enable fn with one-time grant | Portal user can still comment; Stakeholder and Fleet Observer cannot (dashboard, portal, widget, REST, MCP); pre-existing custom roles still can |
| **2** Team-scoped RBAC | Resolver, `canInTeam`, grant/revoke + `assignTierAgentFn` + UI | Team grant on T2 allows `account.execute` only via T2 team; workspace-wide custom-role scopable key is inert; leaving `team_members` revokes; `permissionsForPrincipal` snapshot unchanged |
| **3** Multi-role | add/remove fns + UI | Dev Team + Tier 2 union; upstream role change clears extra hats, keeps team rows (asserted) |

## 9. Testing strategy

- **Unit (fork `__tests__`):** template table ⊆ catalogue and roll-up (T1 ⊆ T2 ⊆ T3); Stakeholder bundle is
  read verbs only (`READ_VERBS`) and lacks `comment.create`; `resolveMcpPermissions` = resolved ∩ scopes;
  `canInTeam` truth table (membership, legacy role, system vs custom workspace grant, scopes).
- **Coverage guards:** every `scanAllMcpTools` tool is in `FORK_MCP_TOOL_PERMISSIONS`; every fork key has a
  defaults row (`WORKSPACE_ADMIN` membership asserted per key); no fork code calls `can()` with a
  `TEAM_SCOPABLE_PERMISSIONS` key; fork server fns appear in the authz matrix with a permission gate.
- **Integration (real Postgres, `QUACKBACK_TENANCY=single` and `pooled`):** REST + MCP (OAuth and key) matrix for
  Owner / Manager / Contributor / Tier 1 / Stakeholder / Fleet Observer; comment create across all five paths;
  key backfill dry-run vs apply; comment-gate one-time grant; role delete cascading team grants; upstream role
  change clearing extra hats.
- **Regression:** upstream suites for `api/auth`, `mcp/handler`, `role.service`, `comments` pass unchanged
  except where a seam intentionally changes behaviour.
- **Merge rehearsal:** after each upstream sync, run the MCP coverage test first — the canary for new upstream
  tools; also check the 6 `isNull(teamId)` filters are still present (D-R9).

## 10. Open items

- **D-C5 (🟡, still open)** Confirm default fleet → tenant mapping (`owner → Admin`, `agent → Fleet Agent`,
  `observer → Fleet Observer`); seeds only, per D-C9.
- **O3 (new)** Dev Team "changelog draft (propose)": upstream has no draft-only key — `changelog.manage` covers
  create, edit **and** publish (`functions/changelog.ts:58,98`). Adopted 🟡: Dev Team gets `changelog.manage`.
  Alternative: a fork `changelog.publish` split, which needs new seams in `functions/changelog.ts` and
  `routes/api/v1/changelog/*`.
- **O4 (new)** Strict read-only (D-R6) covers comments only. Own votes and reactions by read-only teammates are
  not gated (`runAddReaction`, `functions/comments.ts:127-154`; voting) — confirm acceptable, or add keys +
  seams.
- **O5 (new)** Owner/Admin hold `prioritization.score` by construction (all keys), so "only UX Team scores"
  (D-P6) means "UX Team + Owner/Admin" unless 50 adds a fork-side exclusion — confirm.
- **O6** Onboarding checklist legacy resolution (`functions/admin.ts:397`) left as-is (non-security).

## 11. Relationship to other v2 plans

- **30 tiered support:** consumes Phase 2 (`canInTeam`, team-scoped `ticket.escalate`, `assignTierAgentFn`);
  Phase 2 ships first (D-T4). Manager holds `ticket.escalate` (D-T7). Tier templates are starting bundles; 30
  owns tier semantics (roll-up, top tier).
- **40 account actions:** consumes `account.request` / `account.execute` (generic, D-A6) and team-scoped grants;
  owns `min_tier` gating and effective tier (D-A8), approver rules (D-A3), Manager exclusion (D-A4).
- **50 prioritization:** `prioritization.score` (UX Team only) and `prioritization.manage` (admin-only + UX Team)
  defaults defined here (D-P6).
- **60 announcements:** `announcement.manage` (Manager ✓, Fleet Agent template ✓, D-N8).
- **20 control tower:** relies on Phase 1a (tower acts through tenant MCP with human OAuth tokens, D-C2);
  configurable bundles map to tenant templates via `template_key` (§4.7, D-C9); uses `ensurePersonaRoles` /
  `fork_install_persona_roles`. Observer tokens should also request read scopes only.
