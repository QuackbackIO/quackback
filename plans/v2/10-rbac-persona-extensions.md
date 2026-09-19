# RBAC Persona Extensions — v2 Plan

> **Status:** v2 (round-2 revision + staff-review revision, 2026-09-19) — supersedes
> `plans/v1/rbac-persona-extensions-plan.md`. Nothing here is implemented.
> **Depends on:** Foundations (fork migration lineage `packages/db/drizzle-fork` + `drizzle.__fork_migrations`,
> `fork_settings`, shared seams F-1…F-11, `plans/v2/SEAMS.md`) — see `02-fork-conventions.md`, in particular
> §3.3a (fork-only releases run `seedSystemData`).
> **Decisions applied:** D1, D3, D4, D-R1…D-R9, D-T4, D-T7, D-A3, D-A4, D-A6, D-A8, D-P6, D-N8, D-C5 (🟡),
> D-C9.
> **Baseline:** upstream `780a7b577` (fork `main` has no `apps/`/`packages/` diff against it); staff-review
> additions re-verified against `eb79147`. Every `file:line` below was verified against that tree.

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

## 0a. Staff-review changes

| Finding ID | Change | Where in plan |
| --- | --- | --- |
| R1 (tool-name-only gate) | MCP gate is now **argument- and object-aware**: `forkMcpToolGate(auth, def.name, args)` evaluates a per-tool spec `{ base, fields, dispatch, objects }`. Mutation tools require the key of **every** field present (`triage_post`: `statusId→post.set_status`, `tagIds→post.set_tags`, `ownerPrincipalId→post.set_owner`, mirroring REST `permissionsForPostPatch`, `routes/api/v1/posts/$postId.ts:31-38`). `search`/`get_details` branches are keyed on `entity` / ID prefix, so a `dispatch` marker no longer stands in for a check. | §4.3 (5), Appendix A |
| R1 (resources) | MCP resources get the same gate: seam **R-11** in `mcp/server.ts` `scopeGated` (`:33`) calls `forkMcpResourceGate(auth, uri)`; `quackback://members` now requires `member.view` (today scope-only, `server.ts:125-136`). Unmapped resource = deny for team callers. | §4.3 (6), §7, Appendix A |
| R1 (object access) | Tools whose service reads/writes by ID without row checks get fork object checks before the handler: `get_ticket` (`getTicket(id)` has no actor, `mcp/tools/tickets.ts:174`, `ticket.service.ts:125`), `reply_to_ticket`/`add_ticket_note` (`loadTicketOr404`, `ticket-message.service.ts:263`), `link_ticket`/`unlink_ticket` (`ticket-links.service.ts:47-48`) → upstream `assertTicketVisible` (`ticket.service.ts:115`). Dashboard by-ID ticket reads with the same gap (`functions/tickets.ts:128,368,772`) get seam **R-12**. | §4.3 (7), §7 |
| R1 (REST actors) | `ApiAuthContext.permissions` (R-1) is threaded into **every** REST policy actor: shared builder `serviceActorFromApiAuth` (`domains/api/service-actor.ts:16`, 13 route files) = seam **R-9**; 10 inline actor literals = seam group **R-10**; `posts/$postId.comments.ts:159` folded into R-8. Audit-only actor literals are excluded. CI guard fails on any `principalType: 'service'` actor literal under `routes/api/v1/**` without `permissions`. | §4.3 (2), §7, §9, Appendix A |
| R1 (service row scope) | Default adopted: **API-key/service principals stay workspace-wide** (upstream `ticketFilter`/`conversationFilter` bypass, `policy/tickets.ts:48`, `policy/conversations.ts:38`, untouched) **but** a service principal's resolved set is narrowed: without `ticket.view_all` it loses every `ticket.*` key; without `conversation.view_all` every `conversation.*` key; team-scopable keys are always dropped. So copying a team-restricted creator's roles cannot widen their row scope. 🟡 O-R6. | §4.3 (3), §10 |
| R1 (tests) | Mandatory tests added: direct IDs outside the caller's team (MCP + REST + dashboard), mixed allowed/forbidden mutation fields, resources, service-principal narrowing, REST actor guard. | §8, §9 |
| C2 (`canInTeam`) | System-role branch reads **real system-role assignment rows** (`roles.is_system` + `roles.key`, `schema/rbac.ts:30-34`), never legacy `member` and never the zero-row fallback. Service principals never pass `canInTeam`. | §4.4 |
| C2 (zero-role fallback) | `permissionsForPrincipal` falls back to the Manager preset when a `member` has **no** workspace rows (`policy/permissions.ts:74`), and `seedSystemData` backfills such members to Manager on every migrate (`seed-system.ts:136-175`). Fail-closed for tower-managed principals: an empty-bundle sentinel template **`no_access`** keeps them at ≥1 workspace row (a row with no keys resolves to the empty set, `permissions.ts:75`); fork writers never delete the last row; invariant check `assertTowerPrincipalsFailClosed`. | §4.8 |
| C2 (template sync) | `syncPersonaTemplateFn` add-only replaced by `reconcilePersonaTemplate(roleId, mode)`: `add_only` (local default, reports excess keys) or `exact` (removes keys not in the template via upstream `updateRole`, `role.service.ts:304`; removals are ceiling-free). Tower-managed templates (`fork_role_templates.managed_by = 'tower'`) are always reconciled `exact`. | §4.2, §5 |
| C2 (provenance hooks) | New fork table `fork_role_assignment_sources` (per assignment row: `source`, `bundle_key`, `sync_run_id`) + `applyAssignmentSet(principalId, desired, opts)` exact-set writer (principal row `FOR UPDATE`, same lock upstream's role writer takes, `principal.factory.ts:314-320`). Plan 20 builds tower sync on these hooks. | §4.8, §5 |
| F1 (catalogue) | Fork keys, Manager exclusions (`prioritization.manage` move) and preset changes reach a database **only** when `seedSystemData` runs (`seed-system.ts:28`, preset reconcile `:70-104`). Phase 1 depends on Foundations 02 §3.3a item 2 (`fork-migrate` = fork SQL **then** `seedSystemData`, every tenant, every release). Deploy gate asserts catalogue state per tenant. Custom (template) roles are not touched by `seedSystemData` — they reconcile via §4.2. | §4.1, §8 |
| C3 (RBAC side, via 60) | New read key ✱`announcement.view` (Manager ✓, Contributor ✓, Fleet Agent, Fleet Observer) so read-only fleet roles can list announcements without `announcement.manage`; fork MCP read tools from 50/60 added to the inventory. | §4.2, §6, Appendix A.1 |
| X-6 | Removed the request to plan 20 about observer token scopes; seam IDs aligned with `SEAMS.md` (R-9…R-12 new). Open items renamed to the `01-decisions.md` IDs (O-R3…O-R5). | §7, §10, §11 |
| X-7 | No phase of this plan is deferred; §8 states that Phase 0 templates do not bind on REST/MCP until 1a ships. | §8 |

## 1. Changes from v1

| # | v1 issue (review §3.6, X4, X5, X7, cross-plan §4) | v2 resolution |
| --- | --- | --- |
| 1 | "Adding a key = `bun run db:permissions`" — wrong. That script only regenerates the client mirror `apps/web/src/lib/shared/permissions.ts`. | DB side reconciles via `seedSystemData` (`packages/db/src/seed-system.ts:28-175`), invoked from `runMigrations` (`packages/db/src/migrate-runtime.ts:271`) and, for fork-only releases, from `fork-migrate` (02 §3.3a). Both steps are in the Phase 1 gate. |
| 2 | v1 Phase 4 `viewer` legacy role "a small schema/enum addition". | **Dropped entirely** (D-R1, D4 — seat limits never apply). Read-only is expressed by bundles + Phase 1a/1b; no seat mechanics. |
| 3 | "`teamId` is unused, just read it in `permissionsForPrincipal`". | `teamId` is actively excluded with `isNull(teamId)` in 6 places (`policy/permissions.ts:70`, `domains/roles/role.service.ts:98,184,460`, `domains/principals/principal.factory.ts:369`, `functions/settings.ts:178`). v2 **keeps all 6 filters** and adds a fork-only team resolver (§4.4, D-R9). |
| 4 | "Multi-role: stop replace-all" (edit the writer). | The writer `reconcileWorkspaceAssignment` (`principal.factory.ts:357-398`) deletes all workspace rows on every role change. v2 does **not** edit it; extra hats are fork-written rows with documented reset semantics (§4.5) and provenance (§4.8). |
| 5 | **X5 — custom roles not enforced on REST/MCP** (not in v1). | **Phase 1a** (D3): REST and MCP resolve the principal's custom-role set ∩ scopes, threaded into every actor; an argument/object-aware fork gate covers MCP tools and resources. **Permanent fork patch** (D1/Q18). |
| 6 | **X4 — new keys auto-granted to Manager** (`rbac-catalogue.ts:644-649`). | Explicit per-key table (§6); keys Manager must not hold go into the fenced `WORKSPACE_ADMIN_PERMISSIONS` block (F-7). |
| 7 | **X7 / D-R2 — 3-part keys.** | Two-part only; `scopeForPermission` reads `split('.')[1]` (`lib/shared/api-key-scopes.ts:251`). Existing categories only, so `CATEGORY_SCOPES` (`api-key-scopes.ts:211-227`) is untouched. |
| 8 | Contributor assumed a good tier base. | Contributor has `conversation.*` but **no `ticket.*`** (`rbac-catalogue.ts:653-693`). Tier/Fleet templates list `ticket.*` keys explicitly. |
| 9 | `comment.create` gate "+ enforce". | `createCommentFn` is a bare `requireAuth()` shared with portal users (`functions/comments.ts:116-125`); widget reuses `runCreateComment` (`functions/widget/comments.ts:8-9`). Gate applies to **teammates only**, on dashboard (R-6), REST (R-8) and MCP (tool gate) — in scope per D-R6. |
| 10 | `post.view` read key. | **Dropped** — admin feedback inbox already gates on `post.view_private` (`functions/admin.ts:151`). |
| 11 | `roadmap.view` / board-scoped teammates. | **Out of scope** (D-R5). Teammates keep the `isTeamActor` bypass (`policy/boards.ts:54`, `policy/roadmaps.ts:13`). |
| 12 | `domains/*/portal-invites`. | Irrelevant now: all personas are dashboard teammates (D-R3). |
| 13 | Upgrade-safety "localized". | Own seams (§7): **20 upstream files** (11 seam IDs), all small fenced edits; catalogue + nav via shared F-7/F-4. |
| 14 | Cross-plan keys missing. | §6 is the single registry of all fork keys; §4.2 defines all eight templates (+ the `no_access` sentinel). |
| 15 | Fleet `viewer` vs tenant terminology. | No tenant `viewer`; fleet `observer` → **"Fleet Observer"** (D-C5), generalised by configurable tower bundles (D-C9, §4.7). |
| 16 | API keys ignored. | Every key mints a service principal whose legacy role = creator's (`domains/api-keys/api-key.service.ts:106-137`); §4.3 defines key authority for custom-role creators (D-R8) and its row scope (O-R6). |

## 2. Requirements

- **R1** Personas (UX Team, Dev Team, Stakeholder (read-only), Tier 1/2/3 Agent, Fleet Agent, Fleet Observer)
  are custom roles installable as templates without hand-picking keys (D-R3). All are dashboard teammates.
- **R2** A custom role's bundle is the authority on **every** surface: dashboard, REST API, MCP tools **and
  resources** (OAuth and API key), including argument-dependent fields and by-ID object access. No path falls
  back to the legacy Manager/Owner preset for a custom-role holder (D3).
- **R3** Fork keys exist with an explicit, reviewed default per system role, and reach every tenant database.
- **R4** Some grants apply only within a team (tier teams) — prerequisite for 30/40 (D-T4).
- **R5** A person can hold more than one role (e.g. Dev Team + Tier 2) (D-R4).
- **R6** Read-only teammates cannot comment on any surface (D-R6); existing custom-role holders keep commenting.
- **R7** Upgrade-safe: no upstream schema edits, no new legacy role, no seat mechanics (D4); seams limited to
  what R2 needs.
- **R8** Tower-managed principals fail closed: no state of theirs resolves to the Manager preset by fallback.

## 3. How it works today (verified)

- Two axes: legacy `principal.role` (`admin|member|user`, text column, `schema/auth.ts:821-823`) is the
  teammate wall; permission bundles live in `principal_role_assignments` (`schema/rbac.ts:62-97`). Custom
  roles ride legacy `member`; custom roles get `key = id` ("Customs have no semantic key",
  `role.service.ts:262-263`). Legacy `member` therefore says nothing about Manager.
- Resolution: `permissionsForPrincipal` (`policy/permissions.ts:58-76`) unions **workspace-wide** rows,
  falls back to the legacy preset when there are none (`:74`; `member` → Manager). A row whose role has no keys
  resolves to the empty set (`:75`). Dashboard gates resolve it (`functions/auth-helpers.ts:153`);
  non-dashboard audiences carry an empty set (`auth-helpers.ts:158-160`). `can()` uses `actor.permissions` or
  falls back to the legacy role (`policy/authorize.ts:21-23`).
- `seedSystemData` (every migrate): upserts the catalogue, reconciles the four presets insert+delete
  (`seed-system.ts:70-104`), heals stale NULL-grantor preset rows (`:106-133`) and **backfills every `member`
  with zero workspace rows to Manager** (`:136-175`). Upstream role writes delete all workspace rows and insert
  the preset (or `assignRoleId`) under `FOR UPDATE` on the principal row (`principal.factory.ts:314-320,357-398`);
  explicit grants record `granted_by_principal_id`, preset rows leave it NULL (`:391-393`).
- **Gap (X5/R1), REST:** `withApiKeyAuth` and `assertApiPermissions` use `resolveActorPermissions(auth.role)` —
  legacy preset only (`domains/api/auth.ts:134,158`). Policy actors handed to services omit `permissions`: the
  shared `serviceActorFromApiAuth` (`domains/api/service-actor.ts:16-23`, used by 13 route files) and 11 inline
  literals (Appendix A), so every domain `can()` falls back to the preset.
- **Gap, MCP:** contexts carry only `role` (`mcp/types.ts:16-31`, `mcp/handler.ts:98-128,183-200`); actors carry
  no permission set (`mcp/tools/helpers.ts:230-252`); tools gate on scope + `teamOnly` (`helpers.ts:171-204`).
  `triage_post` calls `updatePost` with an attribution object, not a policy actor (`mcp/tools/posts.ts:163-176`,
  `post.service.ts:349-357`); `search`/`get_details` gate per branch on scope + team only
  (`mcp/tools/search.ts:173-276`); resources are scope-gated only (`mcp/server.ts:33-53`), and
  `quackback://members` has no team check at all (`:125-136`); `get_ticket` reads ticket + messages with no actor
  (`mcp/tools/tickets.ts:174-178`). A custom-role holder on MCP therefore acts as **Manager**.
- **Gap, row scope:** service principals (API keys; MCP callers without `userId`, `helpers.ts:220-222`) bypass
  ticket/conversation team visibility (`policy/tickets.ts:48`, `policy/conversations.ts:38`). By-ID ticket reads
  skip `ticketFilter` on MCP (above), in the message/link services (`ticket-message.service.ts:263`,
  `ticket-links.service.ts:47-48`) and on the dashboard (`functions/tickets.ts:128,368,772`, gated on
  `ticket.view` only). Conversation by-ID access is `canViewConversation` = any `conversation.view` holder
  (`policy/conversation.ts:25-29`) on every surface — upstream's chosen semantics (O-R7).
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
`bun run db:permissions` (client mirror only).

**Reaching the database (F1).** Catalogue rows and preset bundles — including the Manager exclusions — change
only when `seedSystemData` runs: step 2 upserts keys, step 4 inserts missing and **deletes stale** preset rows
(`seed-system.ts:47-104`), which is what removes `prioritization.manage` from Manager. Single-tenant boot runs it
in `runMigrations` (`migrate-runtime.ts:271`). A pooled **fork-only** release reaches tenants only through
Foundations' `fork-migrate` running fork SQL **then** `seedSystemData` (02 §3.3a item 2); Phase 1 cannot ship
before that change. Resumed suspended tenants get the same via `fork-migrate --workspace` (02 §3.3a item 4).
`seedSystemData` never touches custom roles, so persona templates reconcile separately (§4.2).

### 4.2 Persona role templates (Phase 0, extended in Phase 1)

- Fork module `apps/web/src/lib/server/fork/rbac/persona-templates.ts`: pure data
  `{ templateKey, version, name, description, keys[], teamScopedKeys[] }`. `teamScopedKeys` are the
  `TEAM_SCOPABLE_PERMISSIONS` the template expects to be granted **team-scoped** (§4.4). `version` bumps on any
  bundle change.
- `installPersonaRolesFn({ templateKeys?, managedBy })` (`fork/rbac/functions.ts`,
  `requireAuth({ permission: 'role.manage' })`) calls upstream `createRole` with explicit `permissionKeys` (reusing
  ceiling, tier cap and `role.created` audit), then writes `fork_role_templates(role_id, template_key, version,
  managed_by)`. Idempotent per template (skip if a row exists; cascade-deleted with the role, so a deleted
  template can be reinstalled).
- **Reconcile (C2)** — `reconcilePersonaTemplate(roleId, { mode, dryRun })` replaces the add-only sync:
  - Computes `missing = template − role` and `excess = role − template`.
  - `add_only`: applies `missing`; reports `excess` (UI badge "differs from template"). Default for
    `managed_by = 'local'`, and the path that delivers Phase 1 keys to roles installed in Phase 0.
  - `exact`: calls upstream `updateRole(roleId, { permissionKeys: template.keys })` (`role.service.ts:304`) —
    audited, ceiling applies to additions only, removals are free (`:326-333`), system roles refused (`:311`).
    Always used for `managed_by = 'tower'`; available to local admins as an explicit "Reset to template".
  - Upstream refuses editing a role the editor holds (`assertNotHeldByEditor`, `role.service.ts:189-202`): the
    tower's installer identity must not hold persona roles; the refusal is surfaced, never bypassed.
  - Records `version` applied; `dryRun` returns the diff for tower preview.
- Pure service `ensurePersonaRoles(installer, templateKeys, { managedBy, reconcile })` + fork MCP tool
  `fork_install_persona_roles` (`mcp/tools/fork-rbac.ts`, registered via F-3) so the tower installs **and
  reconciles** roles per tenant (§4.7).
- **Sentinel `no_access` template** (C2): empty bundle, `managed_by = 'tower'`, installed with the others; used
  only by §4.8 to keep tower-managed principals at ≥1 workspace row.
- Not seeded on migrate: installation is an explicit, audited admin action (ceiling applies).

Bundles (✱ = fork key; **T** = team-scoped grant on the tier team, §4.4; tier bundles are starting points —
30/40 own final tier semantics):

| Template | Bundle |
| --- | --- |
| **UX Team** | `post.view_private`, `post.create`, `post.set_status`, `post.set_tags`, `post.merge`, `status.view`, `tag.view`, `suggestion.view`, `member.view`, `segment.view`, `analytics.view`, `changelog.view_draft`, ✱`comment.create`, ✱`prioritization.score`, `prioritization.manage` (D-P6) |
| **Dev Team** | Feedback triage/status: `post.view_private`, `post.create`, `post.set_status`, `post.set_board`, `post.set_tags`, `post.set_owner`, `post.merge`, `status.view`, `tag.view`, `suggestion.view`, `suggestion.manage`, `member.view`; roadmap: `roadmap.manage`; changelog: `changelog.view_draft`, `changelog.manage` (🟡 O-R4: full publish); ✱`comment.create`. No `prioritization.*`. |
| **Stakeholder (read-only)** | View keys only: `post.view_private`, `changelog.view_draft`, `status.view`, `tag.view`, `member.view`, `analytics.view`. **No** ✱`comment.create` (D-R6). |
| **Tier 1 Agent** | `conversation.view/reply/note/set_status/set_tags`, `ticket.view/reply/note/set_status`, `people.view`, `company.view`, `member.view`, `tag.view`, `integration.view`, `copilot.use`, ✱`account.request`, ✱`account.execute`; **T** ✱`ticket.escalate`, ✱`account.request`, ✱`account.execute` |
| **Tier 2 Agent** | Tier 1 + `conversation.assign`, `ticket.assign`, `ticket.create` (roll-up, D-A8) |
| **Tier 3 Agent** | Tier 2 + `conversation.view_all`, `ticket.view_all` |
| **Fleet Agent** (D-C5) | Contributor preset (incl. ✱`comment.create` and ✱`announcement.view` via the fenced contributor list) + `ticket.view/reply/note/assign/set_status/create` + ✱`announcement.view`, ✱`announcement.manage` (D-N8) |
| **Fleet Observer** (D-C5, D-R7) | Read-only: `post.view_private`, `conversation.view`, `conversation.view_all`, `ticket.view`, `ticket.view_all`, `people.view`, `company.view`, `member.view`, `segment.view`, `status.view`, `tag.view`, `suggestion.view`, `changelog.view_draft`, `analytics.view`, `integration.view`, ✱`announcement.view`. No ✱`comment.create`, no ✱`announcement.manage`. |
| **No access** (sentinel) | Empty. Never assigned by hand; §4.8 only. |

- **Tier keys:** every tier holds `account.request` **and** `account.execute`; what an agent may run or approve
  is decided by the action's `min_tier` against the agent's effective tier (highest tier team they belong to,
  D-A8) in 40 — not by the key. Tier 3 keeps `ticket.escalate` by roll-up; 30 treats T3 as having no target.
- No new read keys: every read a read-only persona needs already exists as a `*.view*` key (`READ_VERBS`,
  `api-key-scopes.ts:234`). Genuine read-only comes from Phase 1a (argument-aware MCP gate) + Phase 1b.
- Read-only teammates keep own votes and emoji reactions (🟡 O-R5, default allowed): `vote_post` and
  `react_to_comment` map to "no key" in the MCP gate; `runAddReaction` (`functions/comments.ts:127-154`) stays
  ungated.

### 4.3 Phase 1a — custom-role enforcement on REST and MCP (D3, permanent fork patch)

**Principle:** authority = *principal's resolved permission set* (narrowed for service principals) ∩ *credential
scopes*, checked per argument and per object, on every surface. Not offered upstream (D1/Q18); R-1…R-5 and
R-8…R-12 are carried permanently and re-applied at every sync. Appendix A is the complete inventory.

1. **REST gate** (`domains/api/auth.ts`, R-1): `requireApiKey` resolves
   `permissions = forkNarrowServicePermissions(await permissionsForPrincipal(apiKey.principalId, role))` once
   and stores it on `ApiAuthContext`; `withApiKeyAuth` (`:134`) and `assertApiPermissions` (`:158`) read
   `auth.permissions` instead of `resolveActorPermissions(auth.role)`. No assignment rows → legacy preset →
   zero change for existing keys (Manager preset holds both `view_all` keys, so narrowing is a no-op for it).
2. **REST actors (R-9, R-10, R-8):** every policy actor built from an API key carries
   `permissions: auth.permissions`:
   - R-9: `serviceActorFromApiAuth` (`domains/api/service-actor.ts:16-23`) — covers the 13 ticket/conversation
     mutation routes that call it.
   - R-10: the 10 inline literals that still build their own actor (Appendix A.3), one added property each.
   - R-8 file also carries its `createComment` actor (`posts/$postId.comments.ts:159`).
   - Audit-only literals (`users/identify.ts:56`, `segments/$slug.members.ts:91,139`, `moderation/-audit.ts:15`)
     are attribution for `recordAuditEvent`, not policy actors — excluded by name in the guard.
   - **CI guard:** a fork test scans `routes/api/v1/**` for object literals containing
     `principalType: 'service'` (and calls of `serviceActorFromApiAuth`) and fails when a literal lacks
     `permissions` and is not on the audit allowlist — new upstream routes force a decision at merge time.
3. **API-key authority and row scope** (R-2, O-R6):
   - The service principal receives a **copy of the creator's workspace-wide role assignments** at creation
     (hook after `createServicePrincipal`, `api-key.service.ts:133-137`). Role edits propagate; the key survives
     creator removal; the creator's ceiling bounds it. Rejected: "creator's live set ∩ scopes" (extra query,
     undefined once `created_by_id` is nulled).
   - **Row scope (default, 🟡 O-R6):** service principals stay workspace-wide (upstream bypass,
     `policy/tickets.ts:48`, `policy/conversations.ts:38`, not patched). Because copying roles cannot copy team
     membership, `forkNarrowServicePermissions(set)` (used by R-1 and by MCP for service callers) removes every
     `ticket.*` key unless the set holds `ticket.view_all`, every `conversation.*` key unless it holds
     `conversation.view_all`, and all `TEAM_SCOPABLE_PERMISSIONS`. A Tier 1/2 creator's key therefore cannot
     touch tickets or conversations; Tier 3 / Fleet Observer / presets keep workspace-wide reach they already
     have on the dashboard. Team-restricted agents use MCP via OAuth (a `user` principal, filtered normally).
     The key-creation UI warns which keys a key will not carry.
   - **Existing keys (D-R8):** `backfillKeyAuthorityFn` (`api_key.manage`): dry-run report of each key whose
     creator holds non-preset assignments and what it would lose (including narrowing); explicit apply.
     Recorded in `fork_settings['rbac.key_backfill']`.
   - Side-effect: service principals count in role holder counts (`role.service.ts:98,184`) and move on
     delete-with-reassign (`:460`) — noted in the UI.
4. **MCP context and actors** (R-3, R-4, R-5): `McpAuthContext.permissions?: ReadonlySet<PermissionKey>`. At the
   single consumer (`mcp/handler.ts:240`, after `resolveAuthContext`) call fork `resolveMcpPermissions(auth)` =
   `permissionsWithinScopes(narrowIfService(await permissionsForPrincipal(principalId, role)), new Set(scopes))`
   (`api-key-scopes.ts:319-325`). Covers OAuth (`handler.ts:98-128`) and API keys. Both actor builders
   (`helpers.ts:230-252`) add `permissions: auth.permissions`.
5. **MCP tool gate — argument-aware** (R-5): the `wrapped` callback in `registerTool` (`helpers.ts:182`) calls
   `await forkMcpToolGate(auth, def.name, args)` after the `teamOnly` guard, for team-role callers only (portal
   OAuth users keep upstream behaviour). `FORK_MCP_TOOL_SPECS` (`fork/rbac/mcp-tool-permissions.ts`), per tool:
   - `base: PermissionKey[] | 'none'` — all required (`'none'` is an explicit decision, e.g. own votes);
   - `fields: Record<argName, PermissionKey>` — for every argument **present** in the call (not `undefined`),
     its key is required; a call with no mutating field is rejected (`triage_post`, `update_changelog`);
   - `dispatch: { arg, branches: Record<value, Spec> }` — `search` on `entity`, `get_details` on TypeID prefix;
     unknown branch = deny;
   - `objects: { arg, check }[]` — object checks run before the handler (item 7);
   - `ownership: { arg, otherKey }` — when the caller is not the object's author, `otherKey` is also required
     (`update_comment` → `comment.edit`, `delete_comment` → `comment.moderate`).
   Denials return the standard error result naming every missing key. **Unmapped tool = deny for team
   callers** + a CI test over `scanAllMcpTools` (`policy/authz-matrix/scan.ts:321`) that fails on any unmapped
   tool **and** on any tool schema argument not classified in its spec (every argument is either a `fields`
   entry, a `dispatch`/`objects` argument, or listed in `inert`), so an upstream tool or argument addition forces
   an explicit fork decision at merge time.
6. **MCP resources** (R-11): `scopeGated` (`mcp/server.ts:33`) calls `forkMcpResourceGate(auth, uri)` after the
   scope check, team callers only; `FORK_MCP_RESOURCE_PERMISSIONS`: `boards → none`, `statuses → status.view`,
   `tags → tag.view`, `roadmaps → none` (teammate board/roadmap reads are open, D-R5), `members → member.view`,
   `help-center/categories → none` (upstream team check `:160` stays). Unmapped resource = deny; CI test over the
   `RESOURCE_SCOPES` keys (`mcp/required-scope.ts:49-56`) fails on an unmapped URI.
7. **Object (row) checks** where services have none:
   - MCP (in the gate's `objects`): `get_ticket`, `reply_to_ticket`, `add_ticket_note` → `assertTicketVisible(
     ticketId, mcpAgentActor(auth))` (`ticket.service.ts:115`, i.e. `ticketFilter`); `link_ticket`/`unlink_ticket`
     → both IDs. Conversation tools keep upstream `assertConversationViewable`/`canViewConversation` (O-R7).
   - Dashboard (R-12): `getTicketFn` (`functions/tickets.ts:128`), `getTicketLinksFn` (`:368`) and
     `exportTicketTranscriptFn` (`:772`) call `assertTicketVisible(ticketId, actor)` before `getTicket`, matching
     the sibling fns that already do (`:143,:750,:889,:901`). Without this a Tier 1 agent without `view_all`
     reads any ticket by ID on the dashboard.
   - REST ticket/conversation routes run as service principals → workspace-wide by the O-R6 default; narrowing
     (item 3) is what limits them.
8. Not fixed (non-security): `functions/admin.ts:397` onboarding checklist uses `permissionsForLegacyRole` (O6).

### 4.4 Phase 2 — team-scoped RBAC (prerequisite for 30/40, D-T4, D-R9)

- **Storage:** upstream's reserved `principal_role_assignments.team_id` (FK → `teams.id` ON DELETE CASCADE,
  `schema/rbac.ts:86-91`). No fork DDL on that table. The partial unique index exempts `team_id IS NOT NULL`
  (`:92-95`), so the fork writer dedupes under `pg_advisory_xact_lock` + existence check.
- **Isolation:** all 6 upstream `isNull(teamId)` filters stay, so team-scoped rows are invisible to every
  upstream check. Merge checklist: watch for removal of those filters (D-R9).
- **`TEAM_SCOPABLE_PERMISSIONS`** = `ticket.escalate`, `account.request`, `account.execute` — checked only in
  fork code (30/40), always through `canInTeam`, never `can()` (fork lint test).
- **Resolver** (`fork/rbac/team-permissions.ts`):
  - `teamPermissionsForPrincipal(principalId)` → `Map<TeamId, Set<PermissionKey>>`, counting a row only if the
    principal is a teammate (`isTeamMember(role)`) **and** in `team_members` for that team (`schema/teams.ts:71`).
  - `systemRolesForPrincipal(principalId)` → the `roles.key` of workspace-wide assignment rows whose role has
    `is_system = true` (`schema/rbac.ts:30-34`). **Never** derived from legacy `principal.role` and never from the
    zero-row fallback (C2): a `member` holding only custom roles, or no rows at all, has no system role here.
  - `canInTeam(actor, key, teamId, scopes?)` = `actor.principalType !== 'service'` **and** (*system-role grant*:
    an Owner or Admin row → any scopable key; a Manager row → `ticket.escalate` only, D-T7 — **or**
    `teamSet(teamId).has(key)`), intersected with MCP/key scopes. Service principals never pass (escalation and
    account actions are human-attributed, D-C2). A scopable key reaching a person only through a
    **workspace-wide custom-role** assignment is inert (flagged in the UI) — so a Tier role can be assigned
    workspace-wide for its dashboard keys without its scopable keys leaking beyond the tier team.
- **Tier assignment** = one fork action `assignTierAgentFn(principal, tierTeam)` (`member.manage`): workspace-wide
  assignment of the Tier N role (dashboard keys) + team-scoped grant of the same role on the tier team
  (scopable keys), both through `applyAssignmentSet` (§4.8). Effective tier / roll-up is computed by 30/40 from
  tier-team membership (D-A8).
- **Writer:** `grantTeamRoleFn` / `revokeTeamRoleFn` (`member.manage` + `assertGrantableRole`,
  `domains/roles/role.grants.ts:22-38`). Audit via `user.role.changed` (`audit/log.ts:68`) with metadata
  `{ scope: 'team', teamId, roleId, op, source }`. A role with no scopable keys is rejected for team-scoped
  assignment.
- **Upstream interactions (accepted):** role delete ignores team-scoped holders in its in-use check and
  cascades them (`role.service.ts:405+`) — the fork page lists them before delete; demotion to `user` leaves
  rows inert.

### 4.5 Phase 3 — multi-role assignment (in scope, D-R4)

- `addRoleAssignmentFn` / `removeRoleAssignmentFn` (fork, `member.manage` + ceiling) insert/delete extra
  workspace-wide rows (`team_id IS NULL`, protected by the existing partial unique index) through
  `applyAssignmentSet` (§4.8), recording `source = 'fork_ui'`. Resolution already unions (`permissions.ts:75`).
  Refuses the last remaining row (use upstream role change) and the Owner preset.
- **Reset semantics (documented, not patched):** any upstream role change calls `reconcileWorkspaceAssignment`,
  which deletes **all** workspace rows (`principal.factory.ts:364-371`) — extra hats are cleared (team-scoped
  rows are untouched: that delete filters `isNull(teamId)`, `:369`); their provenance rows cascade away. Same-role
  saves do not reconcile (`:325-334`). The fork page shows "additional roles"; upstream's members table
  (`functions/settings.ts:165-185`) keeps showing one — acceptable. For tower-managed principals the next tower
  sync detects and repairs the drift (§4.8).

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
  which reads the R-1 resolved set; the route's `createComment` actor (`:159`) gains `permissions`. Same
  `write:feedback` scope as today; legacy keys unaffected (all presets hold the key).
- **MCP:** `add_comment` spec `base: comment.create`, `fields: { isPrivate: comment.view_private }` (a teammate
  may not write internal notes it cannot read); no extra seam.
- **Not gated:** `conversation.convert.ts:60` (tracking note written as part of a conversion the agent is already
  authorised for).
- **Rollout:** `enableTeammateCommentGateFn` (`role.manage`) first runs a one-time, idempotent grant of
  `comment.create` to **every existing non-system role** (`roles.is_system = false`, `schema/rbac.ts:34`) that
  lacks it — **except** installed templates whose bundle omits it (Stakeholder (read-only), Fleet Observer,
  No access) — then sets `fork_settings['rbac.teammate_comment_gate'] = true` in the same transaction. Report
  stored in `fork_settings['rbac.comment_create_backfill']`. Roles created afterwards get the key only if chosen
  (catalogue keys default-off for custom roles, `role.service.ts:22-24`).

### 4.7 Tower role bundles → tenant templates (D-C9; tower side in 20)

- Tower authorization is **configurable role bundles**; `observer`/`agent`/`owner` are only seeds (D-C9). Each
  bundle carries its tower capabilities **and** a tenant role target: `admin` (legacy Admin, seed `owner`) or a
  **`template_key`** from §4.2 (seeds: `agent → fleet_agent`, `observer → fleet_observer`, D-C5 🟡).
- Tenant-side contract this plan provides: `fork_install_persona_roles({ templateKeys, reconcile: 'exact' })`
  installs/reconciles tower-managed templates; `applyAssignmentSet` (§4.8) sets a principal's exact tower-owned
  role set (workspace-wide and tier-team rows) with provenance; `assertTowerPrincipalsFailClosed` reports
  violations. Tenant keys are always enforced by the tenant (Phase 1a); tower capabilities by the tower.

### 4.8 Assignment provenance and fail-closed principals (C2; hooks consumed by 20)

- **Provenance:** every fork writer (`applyAssignmentSet`, hence Phase 2/3 fns, tier assignment and tower sync)
  writes `fork_role_assignment_sources(assignment_id, source, bundle_key, sync_run_id)` in the same transaction
  as the assignment row. `source ∈ { 'tower', 'fork_ui' }`. Rows with no provenance were written by upstream
  (invite, role change, seed backfill). Because upstream's reconcile deletes and re-inserts rows, a lost
  provenance row is itself the drift signal.
- **`applyAssignmentSet(principalId, desired, { source, bundleKey?, syncRunId?, authoritative })`:**
  `desired = { legacyRole: 'admin'|'member'|'user', workspace: RoleId[], team: {teamId, roleId}[] }`.
  In one transaction: lock the principal row `FOR UPDATE` (the lock upstream's role writer takes,
  `principal.factory.ts:314-320`, so the two serialize); if `legacyRole` differs, call upstream's role change with
  `assignRoleId = desired.workspace[0]` (keeps upstream's audit + membership sync); insert missing rows; delete
  rows not in `desired` — **only rows with the same `source`** unless `authoritative`, in which case every
  workspace-wide row not in `desired` (including NULL-grantor Manager rows from invites or backfill) and every
  same-source team row goes. Tower sync always runs `authoritative` for tower-managed principals. Never leaves
  a `member` with zero workspace rows: an empty `workspace` set writes the `no_access` sentinel role instead.
  Returns the applied diff; audited as `user.role.changed` with `{ source, bundleKey, syncRunId }`.
- **Fail-closed (R8):** a tower-managed principal is one with any `source = 'tower'` provenance row or listed by
  the tower. Guarantees:
  - ≥1 workspace row at all times (sentinel), so neither the runtime fallback (`permissions.ts:74`) nor the
    seed backfill (`seed-system.ts:136-175`) can hand them Manager.
  - Full revocation = `legacyRole: 'user'` (upstream reconcile clears workspace rows; `user` maps to no preset),
    plus removal of tower team rows.
  - `canInTeam` ignores the fallback anyway (§4.4).
  - `assertTowerPrincipalsFailClosed()` lists tower-managed principals that have zero workspace rows, hold a
    workspace row without tower provenance, or hold a Manager/Owner row the tower did not assign; run by tower
    sync (repairs via `applyAssignmentSet`), after every `fork-migrate`, and as a deploy-gate query.
  - Remaining window (documented): between upstream principal creation at first sign-in (which may insert a
    Manager preset row) and the tower's first `applyAssignmentSet`. Plan 20 closes it by pre-provisioning with
    the sentinel or applying in the sign-in hook; this plan provides the writer.

## 5. Data model (fork lineage)

`packages/db/drizzle-fork/00NN_fork_rbac.sql` + schema `packages/db/src/fork/schema/rbac.ts`:

**`fork_role_templates`**

| Column | Type | Notes |
| --- | --- | --- |
| `role_id` | `typeIdColumn('role')` **PK** | FK → `roles.id` ON DELETE CASCADE |
| `template_key` | text not null, **unique** | `ux_team`, `dev_team`, `stakeholder_readonly`, `tier1_agent`, `tier2_agent`, `tier3_agent`, `fleet_agent`, `fleet_observer`, `no_access` |
| `template_version` | integer not null | version last applied by install/reconcile |
| `managed_by` | text not null, check in (`local`, `tower`) | `tower` ⇒ always reconciled `exact` |
| `installed_at` | timestamptz not null default now() | |
| `installed_by_principal_id` | `typeIdColumnNullable('principal')` | FK → `principal.id` ON DELETE SET NULL; staff-only → exemption in the fork re-point registry (02 §8, F-5) |

**`fork_role_assignment_sources`**

| Column | Type | Notes |
| --- | --- | --- |
| `assignment_id` | `typeIdColumn('role_asgn')` **PK** | FK → `principal_role_assignments.id` (`schema/rbac.ts:65`) ON DELETE CASCADE |
| `source` | text not null, check in (`tower`, `fork_ui`) | |
| `bundle_key` | text null | tower bundle that produced the row |
| `sync_run_id` | text null | tower sync correlation id |
| `recorded_at` | timestamptz not null default now() | |

- Principal references are indirect (via the assignment row), so no re-point registry entry is needed for
  `fork_role_assignment_sources`; principal merge in upstream moves or deletes the assignment and the cascade
  follows.
- No other DDL: team-scoped and multi-role rows use existing `principal_role_assignments` columns.
- `fork_settings` keys: `rbac.key_backfill`, `rbac.teammate_comment_gate`, `rbac.comment_create_backfill`,
  `rbac.team_scoped_enabled`, `rbac.multi_role_enabled` (Phase 1a is never gated — it is a fix).

## 6. Permissions

Registry of **all fork keys** (shared names) — every other v2 plan references this table. Owner/Admin hold
every key by construction (`rbac-catalogue.ts:645-646`).

| Key | Category (→ scope) | Manager | Contributor | Templates | Enforced in | Plan |
| --- | --- | --- | --- | --- | --- | --- |
| `prioritization.score` (new) | feedback (`write:feedback`) | ✗ (fenced admin block) | ✗ | UX Team | fork scoring fns / MCP | 50 |
| `prioritization.manage` (existing, RESERVED) | feedback | ✗ (**moved** into fenced admin block, D-P6; takes effect on next `seedSystemData`) | ✗ | UX Team | framework config | 50 |
| `ticket.escalate` (new) | support (`write:chat`) | ✓ (D-T7) | ✗ | Tier 1/2/3 (**T**) | `canInTeam` in escalation | 30 |
| `account.request` (new) | support (`write:chat`) | ✗ (fenced admin block, D-A4) | ✗ | Tier 1/2/3 (+ **T**) | `canInTeam` | 40 |
| `account.execute` (new; replaces `account.unlock`/`account.create`, D-A6) | support (`write:chat`) | ✗ (fenced admin block, D-A4) | ✗ | Tier 1/2/3 (+ **T**) | `canInTeam` + action `min_tier` vs effective tier (D-A8) | 40 |
| `announcement.view` (new) | status_page (`read:feedback`, `api-key-scopes.ts:226`) | ✓ | ✓ (fenced contributor list) | Fleet Agent, Fleet Observer | fork announcement admin reads; MCP `list_announcements`, `list_announcement_templates` | 60 |
| `announcement.manage` (new) | status_page (`write:feedback`) | ✓ | ✗ | Fleet Agent (D-N8) | fork announcement writes / MCP | 60 |
| `comment.create` (new) | feedback (`write:feedback`) | ✓ | ✓ (fenced contributor list) | UX, Dev, Fleet Agent (not Stakeholder, Fleet Observer, No access) | R-6, R-8, MCP `add_comment` | 10 |

- `FORK_WORKSPACE_ADMIN_PERMISSIONS` = `prioritization.score`, `prioritization.manage`, `account.request`,
  `account.execute`. `ticket.escalate`, `announcement.view` and `announcement.manage` are deliberately **not** in
  it (Manager ✓). `FORK_CONTRIBUTOR_PERMISSIONS` = `comment.create`, `announcement.view`.
- Fork server functions gate `requireAuth({ permission })`: `role.manage` (templates, reconcile, comment-gate
  enable), `member.manage` (team / multi-role / tier assignment, `applyAssignmentSet` callers), `api_key.manage`
  (key backfill). Regenerate `MATRIX.md`.

## 7. Seams (own; catalogue = F-7, settings page = F-4, MCP registration = F-3, fork-only rollout = F-1/F-11)

| # | Upstream file | Change (one-liner) | Why unavoidable | Re-apply on conflict |
| --- | --- | --- | --- | --- |
| R-1 | `apps/web/src/lib/server/domains/api/auth.ts` | Resolve + narrow `permissionsForPrincipal` in `requireApiKey`; read `auth.permissions` at :134/:158 | REST authority is decided here (X5) | Re-apply 3 marked edits; test "custom-role key denied" |
| R-2 | `apps/web/src/lib/server/domains/api-keys/api-key.service.ts` | After `createServicePrincipal`: `await forkCopyCreatorAssignments(createdById, sp.id)` | Only point where creator and key principal are both known | Re-insert after the service-principal create |
| R-3 | `apps/web/src/lib/server/mcp/types.ts` | `permissions?: ReadonlySet<PermissionKey>` on `McpAuthContext` | Context must carry the set to tools | Re-add field |
| R-4 | `apps/web/src/lib/server/mcp/handler.ts` | After `resolveAuthContext` (:240): `auth.permissions = await resolveMcpPermissions(auth)` | Single consumer of all context shapes | Re-insert after the call |
| R-5 | `apps/web/src/lib/server/mcp/tools/helpers.ts` | Actors: `permissions: auth.permissions`; `wrapped` in `registerTool`: `forkMcpToolGate(auth, def.name, args)` | Tool guard (with args) + actor construction live here | Re-apply 3 marked lines; run MCP coverage test |
| R-6 | `apps/web/src/lib/server/functions/comments.ts` | First line of `runCreateComment`: `await forkAssertTeammateMayComment(auth)` | Dashboard/portal/widget comment create has no permission gate | Re-insert first line of fn |
| R-8 | `apps/web/src/routes/api/v1/posts/$postId.comments.ts` | After `withApiKeyAuth` in POST (:74): `assertApiPermissions(auth, [COMMENT_CREATE])`; actor at :159 gets `permissions` | REST comment create gates only `comment.moderate`; actor falls back to preset | Re-insert both marked lines |
| R-9 | `apps/web/src/lib/server/domains/api/service-actor.ts` | `permissions: auth.permissions` in `serviceActorFromApiAuth` | Shared REST actor for 13 routes | Re-add property; run REST actor guard |
| R-10 | 10 route files (Appendix A.3) | `permissions: auth.permissions` on each inline service actor | Each builds its own actor; services `can()` on it | Re-add property per literal; REST actor guard lists misses |
| R-11 | `apps/web/src/lib/server/mcp/server.ts` | In `scopeGated` (:33): `forkMcpResourceGate(auth, uri)` after the scope check | Resources are registered outside `registerTool` | Re-insert one call; run resource coverage test |
| R-12 | `apps/web/src/lib/server/functions/tickets.ts` | `assertTicketVisible(ticketId, actor)` before `getTicket` at :128, :368, :772 | By-ID dashboard reads skip `ticketFilter` | Re-insert 3 marked lines; team-scope negative test |

**Total: 11 seam IDs over 20 upstream files, all permanent** (R-1…R-5, R-9…R-12 = Phase 1a, D3; R-6/R-8 =
Phase 1b, D-R6). **R-7 (`seat-usage.ts`) retired** (D-R1). Not seams: fork route
`routes/admin/settings.fork-access.tsx` (via F-4), `mcp/tools/fork-rbac.ts` (via F-3), fork migration,
`MATRIX.md` / mirror regeneration.

## 8. Phases and validation gates

No phase is deferred. Phase 0 templates **do not bind on REST/MCP until 1a ships**, so 0 and 1a release
together.

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **0** Persona templates | `fork_rbac` migration; 9 templates (existing keys only, incl. `no_access`); install + reconcile fns; fork settings page | Install twice → one role per template; installer lacking a key → ceiling error; `exact` reconcile removes an added key, `add_only` reports it. **Ships with 1a.** |
| **1a** Custom-role enforcement | R-1…R-5, R-9…R-12; narrowing; key backfill dry-run/apply; tool + resource specs and coverage tests; REST actor guard | All Appendix A rows tested; Tier 1 via MCP OAuth cannot `get_ticket`/`reply_to_ticket` on a ticket outside its teams, nor via dashboard `getTicketFn`; `triage_post` with `statusId`+`ownerPrincipalId` denied for UX Team (no `post.set_owner`), status-only allowed; a custom role without `member.view` denied `quackback://members`; Tier 1-created key has no `ticket.*`; legacy Owner/Manager keys unchanged (golden REST suite green) |
| **1** Fork keys | F-7 block; §6 keys; `bun run db:permissions`; template reconcile. **Requires Foundations `fork-migrate` → `seedSystemData` (02 §3.3a).** | Per tenant after `fork-migrate`: every `FORK_PERMISSIONS` key present in `permissions`; Manager holds `ticket.escalate`/`announcement.view`/`announcement.manage`/`comment.create`, Contributor holds `comment.create`/`announcement.view`, Manager lacks `account.*`/`prioritization.*` (incl. the moved `prioritization.manage`); `MATRIX.md` regenerated; `scopeForPermission` maps as §6. Fork-only release rehearsed on a populated pooled DB and a suspended-then-resumed tenant. |
| **1b** Comment gate | R-6, R-8; `add_comment` spec; enable fn with one-time grant | Portal user can still comment; Stakeholder and Fleet Observer cannot (dashboard, portal, widget, REST, MCP); pre-existing custom roles still can |
| **2** Team-scoped RBAC | Resolver, `systemRolesForPrincipal`, `canInTeam`, grant/revoke + `assignTierAgentFn` + UI | Team grant on T2 allows `account.execute` only via T2 team; workspace-wide custom-role scopable key is inert; custom-role `member` with no Manager row does **not** get `ticket.escalate` via the system branch; zero-row `member` denied; service principal denied; leaving `team_members` revokes; `permissionsForPrincipal` snapshot unchanged |
| **3** Multi-role + provenance | add/remove fns, `applyAssignmentSet`, `fork_role_assignment_sources`, `assertTowerPrincipalsFailClosed` + UI | Dev Team + Tier 2 union; upstream role change clears extra hats + provenance, keeps team rows (asserted); authoritative apply removes an invite-created Manager row; empty set writes `no_access`; concurrent upstream role change + apply serialize (no zero-row state observed) |

## 9. Testing strategy

- **Unit (fork `__tests__`):** template table ⊆ catalogue and roll-up (T1 ⊆ T2 ⊆ T3); Stakeholder bundle is
  read verbs only (`READ_VERBS`) and lacks `comment.create`; `resolveMcpPermissions` = narrowed resolved ∩
  scopes; `forkNarrowServicePermissions` truth table (`view_all` present/absent × ticket/conversation × scopable);
  `forkMcpToolGate` per spec kind (base, every-present-field, empty-mutation reject, dispatch incl. unknown
  branch, ownership); `canInTeam` truth table (membership, legacy role, system-role **row** vs legacy `member`,
  zero rows, custom workspace grant, service principal, scopes); `reconcilePersonaTemplate` diff in both modes.
- **Coverage guards:** every `scanAllMcpTools` tool has a spec and every schema argument is classified; every
  `RESOURCE_SCOPES` URI has a resource entry; REST actor guard (every `principalType: 'service'` literal or
  `serviceActorFromApiAuth` call carries `permissions`, audit allowlist explicit); every fork key has a defaults
  row (`WORKSPACE_ADMIN` membership asserted per key); no fork code calls `can()` with a
  `TEAM_SCOPABLE_PERMISSIONS` key; fork server fns appear in the authz matrix with a permission gate.
- **Mandatory negative authorization tests (staff review R1/C2)**, real Postgres:
  - *Direct IDs outside the caller's team:* Tier 1 (OAuth MCP) calls `get_ticket`, `reply_to_ticket`,
    `add_ticket_note`, `link_ticket` with a ticket assigned to another team → not found/forbidden; same ID via
    dashboard `getTicketFn`, `getTicketLinksFn`, `exportTicketTranscriptFn` → denied; Tier 3 → allowed.
  - *Mixed allowed/forbidden mutation fields:* `triage_post({statusId, ownerPrincipalId})` as UX Team → denied
    with `post.set_owner` named and **no** partial write; status-only → allowed; `create_post` with `tagIds` for
    a role lacking `post.set_tags` → denied; `add_comment({isPrivate:true})` without `comment.view_private` →
    denied; REST `PATCH /posts/:id` same matrix via R-1.
  - *Resources:* custom role without `member.view` reading `quackback://members` → denied; with it → allowed;
    `statuses`/`tags` likewise; portal OAuth user behaviour unchanged.
  - *Dispatch:* Stakeholder `search({entity:'changelogs'})` allowed (`changelog.view_draft`); role without
    `changelog.view_draft` denied; `get_details` on a changelog ID likewise.
  - *REST actors:* a custom-role key calling a ticket mutation route whose service checks a key the role lacks
    → denied (proves R-9/R-10 threading); Tier 1-created key → ticket list returns 403/empty (narrowing).
  - *Fail-closed:* tower-managed principal with all bundles removed resolves to the empty set, survives a
    `seedSystemData` run without gaining Manager; `assertTowerPrincipalsFailClosed` flags a hand-made zero-row
    tower principal.
- **Integration (real Postgres, `QUACKBACK_TENANCY=single` and `pooled`):** REST + MCP (OAuth and key) matrix for
  Owner / Manager / Contributor / Tier 1 / Stakeholder / Fleet Observer; comment create across all five paths;
  key backfill dry-run vs apply; comment-gate one-time grant; role delete cascading team grants; upstream role
  change clearing extra hats; fork-only release reaching every pooled tenant's catalogue.
- **Regression:** upstream suites for `api/auth`, `mcp/handler`, `mcp/server`, `role.service`, `comments`,
  `functions/tickets` pass unchanged except where a seam intentionally changes behaviour.
- **Merge rehearsal:** after each upstream sync, run the MCP tool/argument/resource coverage tests and the REST
  actor guard first — the canaries for new upstream surfaces; check the 6 `isNull(teamId)` filters, the service
  bypass lines (`policy/tickets.ts:48`, `policy/conversations.ts:38`), `canViewConversation` semantics and the
  zero-row fallback (`permissions.ts:74`) / seed backfill (`seed-system.ts:136-175`) are unchanged (D-R9).

## 10. Open items

- **D-C5 (🟡, still open)** Confirm default fleet → tenant mapping (`owner → Admin`, `agent → Fleet Agent`,
  `observer → Fleet Observer`); seeds only, per D-C9.
- **O-R3 (🟡)** Owner and Admin hold every permission by design, so "only the UX team scores" means UX Team +
  Owner/Admin — accept? *Default: accept (no fork-side exclusion).*
- **O-R4 (🟡)** Dev Team changelog: upstream's single `changelog.manage` covers create, edit **and** publish
  (`functions/changelog.ts:58,98`) — give Dev Team full publish, or leave changelog out of Dev Team? *Default:
  full `changelog.manage`.* (A draft-only split would need a fork `changelog.publish` key and seams in
  `functions/changelog.ts` and `routes/api/v1/changelog/*`.)
- **O-R5 (🟡)** Strict read-only teammates (Stakeholder, Fleet Observer) can still vote and add emoji
  reactions — keep allowing that? *Default: yes, allowed.*
- **O-R6 (🟡, new)** Should an API key created by a team-restricted agent (e.g. Tier 1) be able to read and act on
  its creator's teams' tickets and conversations (needs a seam in upstream's ticket/conversation visibility
  filters), or do keys stay workspace-wide and simply carry no ticket/conversation access unless the creator
  can see all of them? *Default: workspace-wide keys, no ticket/conversation access for team-restricted
  creators.*
- **O-R7 (🟡, new)** Upstream lets any teammate with `conversation.view` open **any** conversation by ID
  (lists are team-filtered); tickets are team-filtered by ID after R-12. Keep upstream's conversation behaviour
  for Tier agents? *Default: keep upstream (no seam in `policy/conversation.ts`).*
- **O6** Onboarding checklist legacy resolution (`functions/admin.ts:397`) left as-is (non-security).

## 11. Relationship to other v2 plans

- **02 foundations:** Phase 1 depends on `fork-migrate` running `seedSystemData` after fork SQL (02 §3.3a) and on
  the fork image contents (F-11); this plan's deploy gate queries run after it.
- **30 tiered support:** consumes Phase 2 (`canInTeam`, team-scoped `ticket.escalate`, `assignTierAgentFn`);
  Phase 2 ships first (D-T4). Manager (a real Manager **row**) holds `ticket.escalate` (D-T7). Tier templates are
  starting bundles; 30 owns tier semantics (roll-up, top tier). R-12 gives tier agents team-scoped ticket reads
  by ID on the dashboard.
- **40 account actions:** consumes `account.request` / `account.execute` (generic, D-A6) and `canInTeam`
  (service principals never pass); owns `min_tier` gating and effective tier (D-A8), approver rules (D-A3),
  Manager exclusion (D-A4).
- **50 prioritization:** `prioritization.score` (UX Team only) and `prioritization.manage` (admin-only + UX Team)
  defaults defined here (D-P6).
- **60 announcements:** `announcement.view` (Manager, Contributor, Fleet Agent, Fleet Observer) and
  `announcement.manage` (Manager ✓, Fleet Agent template ✓, D-N8).
- **20 control tower:** relies on Phase 1a (tower acts through tenant MCP with human OAuth tokens, D-C2);
  configurable bundles map to tenant templates via `template_key` (§4.7, D-C9); builds role sync on
  `fork_install_persona_roles` (`exact`), `applyAssignmentSet` (authoritative, provenance) and
  `assertTowerPrincipalsFailClosed` (§4.8).

## Appendix A — Authorization inventory (Phase 1a; verified at `eb79147`)

"Team callers" = legacy `admin|member`. Keys listed are what the fork gate requires **in addition** to the
upstream scope/`teamOnly`/feature guards, which stay. ✚ = argument-dependent; ◆ = object check added by the
fork.

### A.1 MCP tools (`mcp/tools/*.ts`)

| Tool | Today | Fork requirement |
| --- | --- | --- |
| `search` | per-branch scope + team (`search.ts:173-196`) | dispatch `entity`: `posts → post.view_private`; `changelogs → changelog.view_draft`; `articles → none` (no read key; upstream team check stays) |
| `get_details` | per-prefix scope + team (`search.ts:217-276`) | dispatch prefix: `post → post.view_private`; `changelog → changelog.view_draft`; `article`/`kb_article`/`kb_category → none`; unknown → deny |
| `triage_post` | scope + team; `updatePost` with attribution only (`posts.ts:163-176`) | ✚ `statusId → post.set_status`, `tagIds → post.set_tags`, `ownerPrincipalId → post.set_owner`; all present required; none present → reject |
| `vote_post` | scope; `assertPostVotable` | `none` (O-R5) |
| `proxy_vote` | scope + team | `post.vote_on_behalf` |
| `create_post` | scope (portal users too); board gate via `mcpMemberActor` | `post.create`; ✚ `statusId → post.set_status`, `tagIds → post.set_tags` |
| `merge_post`, `unmerge_post` | scope + team | `post.merge` |
| `delete_post`, `restore_post` | scope + team | `post.delete` |
| `get_post_activity` | scope + team | `post.view_private` |
| `add_comment` | scope; `createComment` policy (`comments.ts:107-130`) | `comment.create`; ✚ `isPrivate → comment.view_private` |
| `update_comment` | scope; `assertCommentViewable` | `comment.create`; ◆ non-author → `comment.edit` |
| `delete_comment` | scope; `assertCommentViewable`; service checks legacy role (`comment.service.ts:433-436`) | `comment.create`; ◆ non-author → `comment.moderate` |
| `react_to_comment` | scope; `canViewPost` | `none` (O-R5) |
| `create_changelog`, `update_changelog`, `delete_changelog` | scope + team | `changelog.manage` (publish included, O-R4); `update_changelog` with no field → reject |
| `accept_suggestion`, `dismiss_suggestion`, `restore_suggestion` | scope + team | `suggestion.manage` |
| `create_article`, `update_article`, `delete_article`, `manage_category` | feature + scope + team | `help_center.manage` |
| `list_conversations` | scope + team; `conversationFilter` | `conversation.view` |
| `get_conversation` | `assertConversationViewable` | `conversation.view` (object rule = upstream, O-R7) |
| `reply_to_conversation` | scope + team; service policy | `conversation.reply` |
| `suggest_post`, `share_post` | `canActAsAgent` (`conversation.cards.ts:105`) | `conversation.reply` (matches `sharePostFn`, `functions/conversation.ts:1216`) |
| `set_conversation_status` | scope + team | `conversation.set_status` |
| `list_tickets` | scope + team; `ticketFilter` | `ticket.view` |
| `get_ticket` | scope + team; **no actor** (`tickets.ts:174-178`) | `ticket.view`; ◆ `assertTicketVisible(ticketId)` |
| `create_ticket` | scope + team; service `assertCan` | `ticket.create` |
| `reply_to_ticket` | `assertCan(TICKET_REPLY)`; `loadTicketOr404` (`ticket-message.service.ts:263,409`) | `ticket.reply`; ◆ `assertTicketVisible` |
| `add_ticket_note` | `assertCan(TICKET_NOTE)` (`:485`) | `ticket.note`; ◆ `assertTicketVisible` |
| `link_ticket`, `unlink_ticket` | scope + team; `loadTicketOr404` both (`ticket-links.service.ts:47-48`) | `ticket.assign` (matches dashboard, `functions/tickets.ts:378,389`); ◆ both IDs visible |
| `widget_install_status` | scope + team | `integration.view` |
| `list_announcements`, `list_announcement_templates` (fork, 60, via F-3) | `read:feedback` + team | `announcement.view` |
| announcement write tools (fork, 60) | `write:feedback` + team | `announcement.manage` |
| `list_post_prioritization` (fork, 50, via F-3) | `read:feedback` + team | `post.view_private` |
| other fork tools (`fork_*`, via F-3) | — | declared with their spec at registration; the coverage test covers them like upstream tools |

### A.2 MCP resources (`mcp/server.ts`, R-11)

| URI | Today | Fork requirement (team callers) |
| --- | --- | --- |
| `quackback://boards` | scope only (`:69-81`) | `none` |
| `quackback://statuses` | scope only (`:83-95`) | `status.view` |
| `quackback://tags` | scope only (`:97-109`) | `tag.view` |
| `quackback://roadmaps` | scope only (`:111-123`) | `none` (D-R5) |
| `quackback://members` | scope only, no team check (`:125-136`) | `member.view` |
| `quackback://help-center/categories` | scope + feature + team (`:139-190`) | `none` |

### A.3 REST actors and gates (`routes/api/v1/**`)

| Site | Today | Fork change |
| --- | --- | --- |
| `withApiKeyAuth` / `assertApiPermissions` (`domains/api/auth.ts:134,158`) | legacy preset | R-1: resolved + narrowed set |
| `serviceActorFromApiAuth` (`domains/api/service-actor.ts:16`) — used by `tickets/index.ts` (POST :124), `tickets/$ticketId.{assign,status,priority,reply,note}.ts`, `conversations/$conversationId.{status,read,note,priority,assign,tags,reply}.ts` | no `permissions` | R-9 |
| `tickets/index.ts:66` (GET list) | inline, no `permissions` | R-10 |
| `posts/index.ts:216` (`createPost`) | inline | R-10 |
| `status/summary.ts:31` | inline | R-10 |
| `conversations/$conversationId.ts:28`, `conversations/index.ts:32`, `conversations/$conversationId.messages.ts:36` | inline | R-10 |
| `apps/boards.ts:25`, `apps/search.ts:33`, `apps/suggest.ts:31`, `apps/posts.ts:79` | inline | R-10 |
| `posts/$postId.comments.ts:159` (`createComment`) | inline | R-8 |
| `users/identify.ts:56`, `segments/$slug.members.ts:91,139`, `moderation/-audit.ts:15` | audit attribution | none (guard allowlist) |
| Ticket/conversation row scope for keys | service bypass (`policy/tickets.ts:48`, `policy/conversations.ts:38`) | narrowing (§4.3 item 3), O-R6 |

### A.4 Dashboard by-ID ticket reads (`functions/tickets.ts`, R-12)

| Fn | Today | Fork change |
| --- | --- | --- |
| `getTicketFn` (`:124-129`) | `ticket.view` only; `getTicket(id)` | ◆ `assertTicketVisible` |
| `getTicketLinksFn` (`:360-368`) | `ticket.view` only | ◆ `assertTicketVisible` |
| `exportTicketTranscriptFn` (`:762-772`) | `ticket.view` + team role | ◆ `assertTicketVisible` |
