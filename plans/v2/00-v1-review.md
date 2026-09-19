# Review of the v1 Plans

> **Date:** 2026-09-19 · **Baseline:** fork `main` = upstream `QuackbackIO/quackback` `780a7b577` + the six
> v1 plan docs (now in `plans/v1/`). Each plan was checked claim-by-claim against the code.
> **Verdict:** all six plans are directionally right and the capabilities are achievable, but **none is
> upgrade-safe as written**, and each contains incorrect code references. The v2 plans in this folder
> address every issue below.

## 1. Codebase orientation

- Bun monorepo: `apps/web` (TanStack Start), `packages/db` (Drizzle schema + **hand-written SQL
  migrations**), `packages/widget` (embeddable SDK), `packages/ids`, `packages/email`.
- Already present: a full helpdesk (conversations + tickets, teams, SLAs, workflows, macros, saved views,
  help center, CSAT), Quinn AI assistant with a propose/approve engine, status page, catalogue-driven
  RBAC with custom roles, and the **runtime half of DB-per-tenant ("pooled") tenancy**
  (`apps/web/src/lib/server/workspaces/TENANCY.md`) — but no provisioner.
- Upstream is very active (~1,100 commits / 90 days) and CI enforces several **generated golden files**
  (`authz-matrix/MATRIX.md`, `migration-contract/CONTRACT.md`, `module-state/MODULE-STATE.md`, the
  permissions client mirror).

## 2. Cross-cutting issues (affect several plans)

| #   | Severity | Issue                                                                                                                                                                                                                                                                                          | Resolution in v2                                                            |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| X1  | Blocker  | **Migrations.** Upstream hand-numbers migrations with a hand-maintained journal; the migrator tracks only a high-water timestamp. Fork migrations in that sequence conflict on every upstream release and can cause later upstream migrations to be **silently skipped in production**.       | Separate fork lineage + ledger (`02-fork-conventions.md` §3).               |
| X2  | Major    | Plans add columns to upstream tables (`settings.*_config`, `teams.*`, `assistant_pending_actions.*`). `settings` lives in `schema/auth.ts` (a top churn file) and is guarded by `settings-columns.test.ts` + the control plane's required-column list.                                         | Sidecar tables + `fork_settings` (§3.5).                                    |
| X3  | Major    | Generated files (`MATRIX.md`, `CONTRACT.md`, permissions mirror) conflict on nearly every merge. Module-state and authz scans cover fork server code.                                                                                                                                         | Regenerate-never-merge procedure; pass guardrails by design (§6–7).         |
| X4  | Major    | New permission keys are **auto-granted to Manager** (Owner/Admin/Manager = "all minus a list", `rbac-catalogue.ts:644-649`).                                                                                                                                                                  | Explicit per-key role decision (§5).                                        |
| X5  | Major    | **Custom roles are not enforced on REST API or MCP** — both resolve the legacy role (`domains/api/auth.ts:134,158`; `mcp/tools/helpers.ts:230-251`). A "Tier 1" or "Stakeholder" custom-role holder gets full Manager authority over MCP/OAuth. Undermines every persona.                    | D3: fork patch, offered upstream (`10-rbac-…` Phase 1a).                    |
| X6  | Minor    | `withWorkspaceScopeById` is cited in the wrong file with the wrong signature (it's `workspaces/fleet.ts:147`; 2nd arg is a `WorkspaceScopeOrigin`, not a URL).                                                                                                                                | Corrected; mostly moot after D-C1.                                          |
| X7  | Minor    | Three-part keys (`support.account.unlock`) break `scopeForPermission` (`split('.')[1]`).                                                                                                                                                                                                       | Two-part keys (`account.unlock`).                                           |
| X8  | Major    | "Extends documented plug-in points" is overstated. Only the channel registry is truly pluggable; workflow actions/triggers, macro actions, view rules, sort keys, audit event types and routing results are **closed unions** (multi-file edits).                                             | Each v2 plan counts its seams; `SEAMS.md`.                                  |

## 3. Per-plan findings

### 3.1 Multi-tenant control tower — not feasible as designed

- **Blockers:** fleet pages cannot be "additive routes" in the same app — the root route's
  `beforeLoad` (`routes/__root.tsx:75-89`) loads settings/session and throws without a workspace scope;
  a `/fleet/*` path bypass also misses server functions (they POST to `/_serverFn/…`). The provisioner
  must write the stamped `settings` row, admin principal and setup state itself — onboarding is refused
  (`settings_row_missing`) and first-login bootstrap claims are closed for stamped workspaces
  (`bootstrap-admin.ts:90`).
- **Major:** in-process fan-out shares the per-request memo (`functions/auth-request-cache.ts:26`) across
  tenants (leak risk); the contract requires distinct pooled/direct endpoints (`vendor/contract.ts:422`)
  and a role per tenant; a second Better Auth instance needs its own tables; fleet code would trip
  module-state/authz CI.
- **Wrong facts:** fingerprint columns are migrations 0255/0256/0266 (not 0251/0252); `OSS_TIER_LIMITS`
  is in `tier-limits.types.ts`; real services are `listConversationsForAgent` / `sendAgentMessage`;
  `env://` refs only accept `QUACKBACK_TENANT_SECRET_*` names.
- **Human attribution (follow-up):** API keys cannot attribute to a human — `createApiKey` always mints a
  **service principal** per key (`api-key.service.ts:106`). MCP OAuth tokens **do** carry the human's
  principal (`mcp/handler.ts:98-126`). ⇒ v2 uses a separate app acting via tenant MCP with per-admin
  OAuth tokens.

### 3.2 Announcements banner — feasible with changes

- Over-built scheduling: derive visibility from `publish_at <= now < expires_at` (changelog precedent)
  and drop the publish/expire jobs, sweep and deadline provider (delayed jobs are already covered by
  `earliestPendingJobAt`).
- `widgetCorsHeaders` sets `Cache-Control: no-store` — contradicts the planned 30 s cache.
- `sanitize-tiptap` sanitises JSON, doesn't render HTML — needs a JSON→HTML render step.
- Missing: private-portal access checks, a permission key, locale files for UI strings, a distinct
  prelude global (collides with the widget's `window.__QUACKBACK_*`), widget bundle budget.
- R4 (tower-managed) inherits the tower redesign.

### 3.3 Prioritization scoring — feasible, lowest risk

- Keyset pagination drops unscored posts (NULL in the row comparison, `post.inbox.ts:234`).
- `MetadataSidebar` is shared with the **public portal** route — needs a slot, not new props.
- `prioritization.manage` is described as "Manage prioritization frameworks" (configuration, not scoring).
- Missed a sort enum site (`routes/admin/feedback.tsx:20`) and REST/MCP/CSV exposure.
- `companies.mrrCents` exists as a candidate business-value input.

### 3.4 Tiered support — feasible; §0 hides a blocker

- **Blocker:** routing returns an agent only; settings normalisation hard-codes `auto_assign_active`
  (`settings.conversation-routing.ts`). A tier strategy needs upstream edits — or use workflows.
- **Major:** `applySlaToConversation` resets clocks on re-apply; conversation/ticket pairs have
  independent assignees; `assignTicket` never runs team distribution; clearing the agent removes T1's
  visibility under `conversation.view` scoping; new events/triggers need CONTRACT verb changes; the
  `escalate` action touches ~9 upstream sites.
- **Wrong facts:** `createMyTicket` is in `requester.service.ts`; stage-change notifications already
  exist (bell + close email).

### 3.5 Support account actions — feasible only after defining "account"

- **Blocker:** no native lockout/ban exists; `unblock()` is an anti-spam gate. (Resolved by D-A1: accounts
  are external.)
- **Major (security):** 2FA reset / force sign-out accept any target including the owner; no
  requester≠approver guard; audit rows attributed to Quinn, lost for non-conversation actions, and
  written best-effort.
- **Major (design):** `runWithPipeline` is private and Quinn-shaped; `originRole` has no human value;
  pending actions require a conversation/ticket parent; connector lookup is per-assistant-agent.

### 3.6 RBAC personas — accurate and sensible

- Phases 0–2 safe. Phase 4 (`viewer` legacy role) touches 100+ scattered role checks — not "small".
- `db:permissions` only regenerates the client mirror; DB reconcile is `seedSystemData`.
- Contributor lacks `ticket.*`; a `comment.create` gate would block portal users; `teamId` is actively
  filtered out (`isNull`) in 6 places, not merely unused.

## 4. Cross-plan inconsistencies

1. Keys referenced but not in the RBAC plan: `support.escalate`, `support.action.request/approve`,
   announcement authoring.
2. `viewer` meant two things (fleet role vs tenant role) → fleet role renamed `observer` (D-C5).
3. The tower provisioned fleet admins as tenant **admin**, so "per-tenant RBAC still applies" was empty →
   fleet-role → tenant-role mapping (D-C5).
4. Dependencies were unsequenced → see build order in `README.md`.

## 5. Questions raised

All questions and the owner's answers are recorded in `01-decisions.md`.
