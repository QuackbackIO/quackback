# Tier-Gated Support Actions (Account Unlock / Create) — Design Plan

> **Status:** Proposal / planning only. Nothing here is implemented.
> **Goal:** Give support agents **permissioned "account actions"** they can run from the agent
> workspace — e.g. **Tier 1 can unlock an account**, **only Tier 2 can create an account** — with a
> **request→approve escalation** path when a lower tier lacks the permission, full **audit**, and support
> for acting on **Quackback-native identities** and/or the **customer's external product** account system.
> This is the "account unlock/create tooling" layer of the tiered helpdesk
> (`plans/v1/tiered-support-helpdesk-plan.md`).

## 0. Relationship to the tiered-support plan

This extends `plans/v1/tiered-support-helpdesk-plan.md`. That plan adds tiers (as typed teams) + an escalate
primitive; **this plan adds the tier-gated _actions_ agents perform on accounts**, and reuses the
escalation/approval idea so an over-tier action (T1 → create) becomes a **request approved by T2**.

## 1. Requirements

| #   | Requirement                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| R1  | A catalog of **support actions** invokable from the agent workspace against a customer/account.                        |
| R2  | **Tier/permission gating**: T1 → `unlock account`; only T2 → `create account` (configurable).                          |
| R3  | When a lower tier lacks the permission, allow a **request** that a higher tier **approves** (not just a hard deny).    |
| R4  | Actions can execute on **Quackback-native identities** and/or the **customer's external product** (connector/webhook). |
| R5  | Every action (request, approval, execution, denial) is **audited** with actor, subject, and outcome.                   |
| R6  | Reuse the existing permissioned-action + approval infrastructure; keep changes additive; multi-tenant-safe.            |

## 2. TL;DR recommendation

Build a **Support Actions framework** by **reusing the Quinn write-tool/approval engine** for human agents:

- Define account actions as **specs** (mirroring `AssistantToolSpec`: `name`, `risk`, `permissions`,
  params schema, `execute`, `summarize`, `idempotencyKey`) in a new `support-actions/*` catalog.
- Gate each spec with a **new RBAC permission** (`support.account.unlock`, `support.account.create`) and
  map **tiers → custom roles** that grant the right subset (T1 role: unlock; T2 role: unlock + create).
- **Execution is autonomous when the agent holds the permission** (T1 unlock), and **routes to a pending
  approval** when they don't (T1 create → proposed → a T2 who holds `support.account.create` approves &
  executes) — reusing `assistant_pending_actions` + `decidePendingAction` + the pending-action card, and
  the `requiresApproval` decision pattern.
- **Back the action** with a pluggable backend: **native** (`unblock()`, `createPortalUser()`, session
  revoke, 2FA reset), a **connector (outbound MCP)** tool on the customer's system, or a **signed
  webhook** — chosen per action per workspace.
- **Audit** every invocation via `assistant_tool_calls` (already built) + add `support.account.*` events
  to the security `audit_log`.

## 3. Current-state findings (what to reuse)

### 3.1 The permissioned action + approval engine (Quinn) — reuse this

- **Tool spec** `AssistantToolSpec` (`domains/assistant/assistant.toolspec.ts`): `name`, `label`,
  `risk: read|write|control`, `permissions: PermissionKey[]`, `parents`, `approvalPolicy: always|approval`,
  `execute`, `summarize`, `idempotencyKey`.
- **Pipeline** `runWithPipeline` (`domains/assistant/assistant.tools.ts`): `resolveEffectiveToolMode` →
  `autonomous` (checks `can(actor, permission)`, claims a tool-call row, executes) / `propose` (writes a
  pending action) / `simulate`.
- **Per-tool allow/ask/deny dial**: `ASSISTANT_TOOL_RULES = ['allow','ask','deny']` stored in
  `settings.assistantConfig.*.toolRules`, applied by `applyBuiltInToolRules()`; connector equivalent in
  `connectors.tool_policies` (`always|approval|never`).
- **Pending actions / approval**: table `assistant_pending_actions` (`proposed|approved|rejected|
expired|executed|failed`, `idempotencyKey`, parent = conversation|ticket|workspaceThreadKey),
  `pending-actions.service.ts` (`proposePendingAction`, `decidePendingAction`, TTL sweep),
  `functions/assistant-actions.ts` `decideAssistantAction()` — **approver must hold every
  `spec.permissions`**, executes with the approver's actor. UI `components/conversation/pending-action-card.tsx`.
- **Execution audit**: `assistant_tool_calls` (`started|succeeded|failed|denied|skipped_duplicate`,
  `idempotencyKey`, `pendingActionId`, `principalId`), `tool-audit.ts`, 180-day retention.
- **Actor model**: `AssistantToolContext.actor` already reserves on-behalf-of-teammate substitution for a
  future human surface.

### 3.2 Native account operations (Quackback identities)

Identity layers (`packages/db/src/schema/auth.ts`): **`user`** (Better Auth), **`account`** (credentials),
**`principal`** (product actor). Existing ops:

- **Unlock-ish**: `unblock()` (`domains/principals/blocking.ts`, clears `principal.blockedAt`) via
  `unblockPersonFn` (`people.manage`); `forceSignOutUserFn` (session revoke, `auth.manage`);
  `adminResetTwoFactorFn` (2FA reset / clears TOTP state, `auth.manage`).
- **Create**: `createPortalUser()` (`domains/users/user.create.ts`) via `createPortalUserFn`
  (`people.manage`); `identifyPortalUser()` (`POST /api/v1/users/identify`); team invites
  (`sendInvitationFn`), portal invites, SSO JIT provisioning.
- No single "suspend/ban/unlock account" abstraction and **blocking is not audited today** (gap to fix).

### 3.3 RBAC, roles, tiers

- Catalogue-driven: `packages/db/src/rbac-catalogue.ts` (`PERMISSIONS`, `PERMISSION_CATALOGUE`,
  `SYSTEM_ROLE_PERMISSIONS`), client mirror `lib/shared/permissions.ts` (regen `bun run db:permissions`).
- Keys are `noun.verb`; adding a key is a TS catalogue change + seed reconcile (no migration).
- Roles: system presets (owner/admin/manager/contributor) + **custom roles** (`schema/rbac.ts`,
  `domains/roles/role.service.ts`); assignment via `principal_role_assignments` (**workspace-wide today**,
  `teamId IS NULL`; a `teamId` column exists but is unused → future team-scoped RBAC).
- Enforcement: `requireAuth({ permission })` / `can(actor, permission)`.
- **Tier→permission mapping today**: tiers (from the tiered-support plan) are teams; RBAC is per-principal.
  So map each tier to a **custom role** ("Tier 1 Agent", "Tier 2 Agent") with disjoint permission sets and
  assign the role when an agent joins that tier.

### 3.4 The `requiresApproval` pattern (template for T1-request → T2-approve)

`policy/posts.ts` / comments moderation return `{ allowed: true, requiresApproval: boolean }` vs
`{ allowed: false, reason }`; handler persists `pending` vs `published`; a moderator with the right
permission approves. This is the precedent for "allowed-but-held" — exactly how T1's create becomes a
pending request a T2 approves.

### 3.5 Audit

`audit_log` (`schema/audit-log.ts`, `audit/log.ts`): `occurredAt`, denormalized actor, `eventType`
(closed union `AuditEventType`), `eventOutcome`, `targetType/targetId`, `before/after`, `metadata`;
`recordAuditEvent` / `withAuditEvent`; `audit.view` feed; 365-day retention. Existing adjacent events:
`user.role.changed`, `user.removed`, `session.revoked.*`, `two_factor.reset_by_admin`.

### 3.6 Outbound to external customer systems

- **Agent Connectors (outbound MCP)** — `schema/connectors.ts`, `domains/assistant/connectors/*`,
  `mcp-client.ts`: remote MCP servers with per-tool policies (`always|approval|never`); the natural
  synchronous backend for `unlock_account`/`create_account` on the customer's product.
- **Webhooks** — `domains/webhooks/*`, HMAC-signed, SSRF-guarded: emit an event the customer handles.
- **Workflow actions** — `workflows/action.executor.ts`: a `call_external_account_api` action could be
  added, but lacks approval/idempotency parity (use only as an execution backend inside a spec).

## 4. Design

### 4.1 Support Actions framework (reuse the pipeline)

A new **`support-actions` catalog** of code-defined specs (the legacy dynamic `assistant_custom_actions`
table was dropped in `0262` — specs are code, not rows). Each `SupportActionSpec` mirrors
`AssistantToolSpec`:

```ts
interface SupportActionSpec {
  name: string // 'account.unlock' | 'account.create'
  label: string
  description: string
  risk: 'write' | 'control'
  permissions: PermissionKey[] // e.g. ['support.account.create']
  params: ZodSchema // subject/account + inputs
  backend: SupportActionBackend // native | connector | webhook (per-workspace config)
  execute(args, ctx): Promise<Result>
  summarize(args): string // approval-card text
  idempotencyKey(args, ctx): string
  approvalPolicy?: 'always' | 'approval' // per-action allow/ask/deny dial
}
```

Register into the **same execution pipeline** (`runWithPipeline` / `executeApprovedPendingAction`) or a
thin parallel `runSupportAction` that calls the same primitives, so **approval, idempotency, gate
envelopes, and audit come for free**. Set the **human agent's actor from the start** (not just
post-approval), and always `claimToolCall` for audit even on autonomous runs.

### 4.2 Permission & tier model

- Add RBAC keys under category `support`: **`support.account.unlock`**, **`support.account.create`**
  (extensible: `support.account.reset_2fa`, `support.account.revoke_sessions`, …), plus optionally
  `support.action.request` (may propose over-tier actions) and `support.action.approve`.
- Map **tiers → custom roles**: _Tier 1 Agent_ = `support.account.unlock` (+ inbox perms); _Tier 2 Agent_
  = `unlock` + `support.account.create`; _Tier 3_ = superset. Assign via invite `roleId` /
  `updateMemberRole`.
- Per-action **allow/ask/deny dial** (mirror `ASSISTANT_TOOL_RULES`) stored in a new
  `settings.supportActionsConfig` so an action can be forced to always-approve even for a tier that holds
  the permission.

### 4.3 The two flows

**Unlock account (T1 and up) — immediate:**

```
Agent (holds support.account.unlock) clicks "Unlock account" on the customer
 → runSupportAction(account.unlock, { subject }, actor=agent)
 → can(actor, 'support.account.unlock') = true → autonomous
 → claimToolCall → execute backend (native unblock()/session revoke, or connector unlock_account)
 → finalize + audit(support.account.unlock, success)
```

**Create account — T2 only, with T1 request→approve:**

```
Agent attempts "Create account"
 → decision: allowed && !can(actor,'support.account.create')
      → requiresApproval = true  (allowed-to-REQUEST, per §3.4 pattern + support.action.request)
 → proposePendingAction(account.create, args, originRole='human_support', initiator=agent)
 → surfaces a pending-action card + escalates to the Tier-2 queue (reuse escalation primitive)
T2 agent (holds support.account.create) approves:
 → decidePendingAction(approved) → executeApprovedPendingAction (executes as T2 actor)
 → backend create (native createPortalUser()/invite, or connector create_account)
 → audit(support.account.create, success, approver + initiator)
If the agent has NO request permission at all → hard deny + audit(denied).
```

This unifies "escalate" and "request approval": an over-tier action is proposed and routed to the tier
that holds the permission — the approver check (`must hold spec.permissions`) already enforces "only T2
can create."

### 4.4 Execution backends + subject resolution

- **Backend per action, per workspace** (`support_actions_config`): `native` (call domain services),
  `connector` (invoke a configured Agent Connector MCP tool like `unlock_account`/`create_account`), or
  `webhook` (emit a signed `support.account.*` event the customer handles). Same spec, swappable backend
  — so "account" can mean a Quackback principal for one app and an external product account for another.
- **Subject/account** resolved from the conversation's visitor/principal, the customer profile (People),
  or an external account id captured on the ticket/company (`custom_attributes`). Add `subjectRef` to the
  pending-action args.

### 4.5 UI

- **Agent Actions panel**: on the conversation/ticket header and the customer profile (People view), an
  "Actions" menu listing catalog actions **filtered by the agent's permissions/tier**. Actions above the
  agent's tier show as **"Request…"** (creates a pending approval routed to the owning tier) rather than
  hidden — so T1 sees "Request account creation".
- **Approval**: reuse `pending-action-card.tsx` (generalized for human-initiated support actions) in the
  inbox for the approving tier; approve/reject → `decideSupportAction` executes as approver.
- **Settings**: a **Support Actions** admin page (catalog on/off, backend mapping, per-action allow/ask/
  deny, which permission/tier each requires) — mirror `updateAssistantToolRules`.

### 4.6 Audit

- Per-invocation: `assistant_tool_calls` (reused) links request↔approval↔execution via `pendingActionId`.
- Admin feed: add `support.account.unlock`, `support.account.create`, `support.account.request`,
  `support.account.request.approved/rejected` to `AuditEventType` + emit via `recordAuditEvent`
  (before/after, subject, backend). Also **add audit to `block()/unblock()`** (currently unaudited).

## 5. Data model changes (additive)

- **RBAC**: new permission keys in `rbac-catalogue.ts` (no migration; seed reconcile) + regenerate mirror.
- **Pending actions**: reuse `assistant_pending_actions`; add nullable `initiatorPrincipalId`,
  `actionKind` (`assistant|support`), and `subjectRef` (jsonb) — additive columns.
- **Settings**: `settings.supportActionsConfig` JSON (catalog dials + backend mapping).
- **Audit**: extend `AuditEventType` union (code-only).
- **(Optional)** dedicated `support_action_requests` table if we want a first-class request object outside
  the pending-actions table (recommend reusing pending-actions first).
- Ships via the standard + fleet migrator.

## 6. Backend seams to extend (reuse, don't rewrite)

- Spec catalog + pipeline: new `domains/support-actions/*` reusing `assistant.tools.ts` primitives
  (`runWithPipeline`, `proposePendingAction`, `executeApprovedPendingAction`, `claimToolCall`).
- Approve/reject: sibling of `functions/assistant-actions.ts` (`decideSupportActionFn`) — approver must
  hold `spec.permissions`.
- Native backends: `domains/principals/blocking.ts` (`unblock`), `domains/users/user.create.ts`
  (`createPortalUser`), `admin.ts` (`forceSignOutUserFn`), `admin-reset-two-factor.ts`.
- External backends: `domains/assistant/connectors/*` (MCP callTool), `domains/webhooks/*`.
- Permissions: `rbac-catalogue.ts` + `roles/role.service.ts` (custom tier roles).
- Audit: `audit/log.ts`.
- Ties to escalation: `domains/support/escalation.service.ts` (from the tiered-support plan) for routing a
  request to the owning tier.

## 7. Multi-tenant & upgrade-safety

- **Multi-tenant:** per-workspace (permissions, roles, action config, connectors); ships via fleet
  migrator; composes with the control-tower plan (a fleet admin could audit account actions across apps).
- **Upgrade-safety:** almost entirely **additive** — new permission keys, a new support-actions catalog +
  server fns + settings + UI panel, additive pending-actions columns, new audit event types, and
  connector/webhook backends that reuse existing systems. It **extends documented plug-in points** (tool
  spec shape, pending-actions, connector policies, RBAC catalogue, audit taxonomy), so it's a strong
  upstream-contribution candidate rather than a fork. Note the dropped `assistant_custom_actions` table
  (`0262`) — build **code-defined specs**, not a dynamic table.

## 8. Phased plan (with validation)

| Phase                           | Deliverable                                                                                                                   | Validation                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **1. Permissions + tier roles** | `support.account.unlock` / `.create` keys; seeded; "Tier 1/2 Agent" custom roles                                              | T1 role has unlock only; T2 has both; `requireAuth` gates enforce                                                    |
| **2. Action framework**         | `SupportActionSpec` + `runSupportAction` reusing the pipeline; `account.unlock` + `account.create` specs (native backend)     | Unit/db: T1 unlock executes + audits; permission checks; idempotency                                                 |
| **3. Request→approve**          | Propose on over-tier attempt; `decideSupportActionFn` (approver holds `support.account.create`); pending-action card in inbox | T1 "Request create" → pending → T2 approves → executes as T2, audited; T2 without perm cannot approve                |
| **4. Agent UI**                 | Actions panel on conversation/ticket + customer profile; tier-filtered; "Request…" affordance                                 | Manual: T1 sees Unlock + Request-create; T2 sees both; approve flow works                                            |
| **5. External backends**        | Connector + webhook backend adapters; per-workspace backend mapping in settings                                               | Configure a connector `unlock_account`; action calls external tool with approval; webhook variant fires signed event |
| **6. Audit hardening**          | `support.account.*` audit events; add audit to block/unblock                                                                  | Audit feed shows request/approve/execute with actor + subject + outcome                                              |

## 9. Validation & testing strategy

- **Unit/db:** permission gating (T1 vs T2), autonomous vs propose branch, approver-permission enforcement,
  idempotency (double-click / retry), audit rows for request/approve/execute/deny.
- **Manual (GUI):** the two flows end-to-end (T1 unlock immediate; T1 create → T2 approve) plus a denied
  case — recorded as a walkthrough; regression that Quinn's own tool-approval flow is unaffected.
- **External backend:** a stub connector/webhook receiver to prove the external `unlock_account`/
  `create_account` path with approval + audit.

## 10. Open questions

1. **What is an "account" for you** — a Quackback identity (principal/user) or the **customer's external
   product** account? (Drives native vs connector/webhook as the default backend. The framework supports
   both; we pick defaults per action.)
2. **Over-tier behavior**: T1 attempting create → **request approval** (recommended) vs **hard deny**? Per
   action?
3. **Tier→role mapping**: custom roles per tier now (recommended), or wait for **team-scoped RBAC**
   (`principal_role_assignments.teamId`, currently unused)?
4. **Which actions** in v1 beyond unlock/create (reset password, revoke sessions, reset 2FA, merge, refund)?
5. **Approval routing**: does a create request go to a **specific Tier-2 queue** (via the escalation
   primitive) or any holder of `support.account.create`?
6. **Should Quinn** be able to invoke these (with the same approval gates), or humans only initially?
7. **External account identity**: where is the external account id stored/resolved (company
   `custom_attributes`, ticket field, identity mapping)?

## 11. File / seam index

Reuse (existing):

- Action/approval engine: `domains/assistant/assistant.toolspec.ts`, `assistant.tools.ts`,
  `pending-actions.service.ts`, `schema/assistant-pending-actions.ts`, `schema/assistant-tool-calls.ts`,
  `functions/assistant-actions.ts`, `components/conversation/pending-action-card.tsx`, `tool-audit.ts`
- Per-tool dial: `lib/shared/assistant/config.ts` (`ASSISTANT_TOOL_RULES`), `settings.assistant.ts`
  (`updateAssistantToolRules`), connector policies `lib/shared/assistant/connectors.ts`
- Native account ops: `domains/principals/blocking.ts`, `domains/users/user.create.ts`,
  `functions/admin.ts` (`createPortalUserFn`, `forceSignOutUserFn`, invites),
  `functions/admin-reset-two-factor.ts`, `principal.factory.ts`
- RBAC: `packages/db/src/rbac-catalogue.ts`, `lib/shared/permissions.ts`, `schema/rbac.ts`,
  `domains/roles/role.service.ts`, `policy/permissions.ts`, `policy/authorize.ts`, `functions/auth-helpers.ts`
- requiresApproval precedent: `policy/posts.ts`, `domains/moderation/moderation.service.ts`
- Audit: `schema/audit-log.ts`, `audit/log.ts`
- External backends: `domains/assistant/connectors/*`, `schema/connectors.ts`, `domains/webhooks/*`,
  `workflows/action.executor.ts`
- Escalation tie-in: `plans/v1/tiered-support-helpdesk-plan.md` (`domains/support/escalation.service.ts`)

New (to build, additive):

- Permission keys `support.account.unlock` / `support.account.create` (+ optional request/approve)
- `domains/support-actions/*` (spec catalog + `runSupportAction` + native/connector/webhook backends)
- `decideSupportActionFn` server fn + generalized approval card
- `settings.supportActionsConfig` + admin Support Actions page
- Additive `assistant_pending_actions` columns (`initiatorPrincipalId`, `actionKind`, `subjectRef`)
- `support.account.*` audit event types (+ audit block/unblock)
- "Tier 1/2 Agent" custom role presets

## 12. Relationship to other plans

- **Extends** `plans/v1/tiered-support-helpdesk-plan.md` (tiers + escalation) — this is its account-tooling layer.
- **Composes** with `plans/v1/multi-tenant-control-tower-plan.md` (per-app actions; fleet-wide audit).
- Independent of the announcements and prioritization plans.
