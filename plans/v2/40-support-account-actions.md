# Support Account Actions (Connected-App Actions) — v2 Design Plan

> **Status:** v2 (round-2 revision) — supersedes `plans/v1/support-account-actions-plan.md`. Planning only; nothing implemented.
> **Depends on:** Foundations (fork lineage, `fork_settings`, shared seams F-4/F-5/F-7, `02-fork-conventions.md` §3, §8, §10);
> `10-rbac-persona-extensions.md` (fork key block, "Tier N Agent" roles, team-scoped resolver `canInTeam` for D-A3);
> `30-tiered-support.md` (`fork_team_tiers`, `escalateTicket` contract §11, tier-membership helper).
> **Decisions applied:** D1, D2, D4 · D-A1 … D-A14 (all ✅) · D-T2, D-T3 (routing) · D-R2 (2-part keys).
> **Goal:** From a ticket, support agents run **actions defined by the customer's own connected apps** (unlock, create, and
> whatever else an app advertises) against the ticket requester's account in that app. Each action has a **minimum tier**;
> agents below it file a **request** that escalates the ticket to a tier that can approve it. Separation of duties and a
> durable audit trail naming the humans involved.

## Round-2 changes

| Change                                                                                                                                                                                        | Driver         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Fixed `unlock`/`create` kinds replaced by a **data-driven action catalogue** per connected app (`fork_account_action_definitions`); adding an action needs no code, key or migration.         | D-A6           |
| Per-action keys `account.unlock` / `account.create` replaced by generic **`account.request`** + **`account.execute`**; each action carries a **`min_tier`**.                                   | D-A6           |
| Authorization = key **and** effective tier ≥ `min_tier`; effective tier = highest tier team membership (roll-up).                                                                            | D-A8           |
| Backend = one standard **"Quackback Account Actions API"** that each connected app implements (advertise + execute, HMAC-signed). **MCP connector backend removed** from v1 (possible later). | D-A9           |
| `fork_external_account_links` **removed**; the app resolves its own account from the identity we send (email, principal id, identify-time external id, allow-listed attributes).            | D-A5           |
| **Ticket-only**: People-profile slot (old seam A-3) and auto-created `back_office` tickets removed.                                                                                           | D-A12          |
| Over-tier request **escalates the ticket** to the lowest tier ≥ `min_tier` (no more `routeBy`/`queue_only`).                                                                                  | D-A11          |
| Requests expire after **72 h** (constant) and the requester is **notified** → needs a sweeper job (new seam A-5).                                                                             | D-A13          |
| Owner/Admin break-glass approval (audited, never self-approval); Managers excluded; requester ≠ approver; approver on the owning tier's team with fallback — all now ✅.                        | D-A10, D-A4, D-A2, D-A3 |
| Quinn access described as a **later, per-workspace, off-by-default** phase (seam A-6, deferred); v1 is humans only.                                                                           | D-A7           |
| 2FA-reset / force-sign-out target guard is an **independent upstream PR**, not part of this plan's phases.                                                                                    | D-A14, D1      |
| Settings page registered through shared **F-4**; keys through **F-7**; customer principal re-point through **F-5**.                                                                            | `02-…` §10     |
| Old open items A-Q1…A-Q7 resolved by decisions or contracts; new items in §10.                                                                                                                 | —              |

## 1. Changes from v1

| v1 issue (review §3.5 + brief)                                                                                                                                            | v2 resolution                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Account" undefined; native `unblock()` treated as unlock (it is an anti-spam gate).                                                                                     | D-A1: accounts are **external**. The only backend is the connected app's HTTP API (D-A9). No native account operations.                                                                                                                        |
| Native 2FA reset / force sign-out proposed as backends; both accept any target incl. the owner (`functions/admin-reset-two-factor.ts:29-32`, `functions/admin.ts:289-299`). | **Out of scope.** Tracked as an independent upstream hardening PR (D-A14, §3).                                                                                                                                                                  |
| Three-part keys `support.account.*` break `scopeForPermission` (reads `split('.')[1]`).                                                                                  | Two-part generic keys `account.request`, `account.execute` (category `support`, D-R2, D-A6).                                                                                                                                                   |
| New keys silently auto-granted to Manager (`rbac-catalogue.ts:649`).                                                                                                      | D-A4: both keys in the fork block of `WORKSPACE_ADMIN_PERMISSIONS` (`rbac-catalogue.ts:613`) via F-7.                                                                                                                                          |
| Reuse `runWithPipeline` — private (`assistant.tools.ts`) and Quinn-shaped.                                                                                                | **Not reused.** Fork domain `lib/server/fork/account-actions/` owns its request/approve/execute state machine. Reused: `can()`, `safeFetch`, the webhook HMAC scheme, `encrypt/decrypt`, `escalateTicket` (30).                                 |
| Audit rows under Quinn's principal; approved actions attributed to Quinn.                                                                                                | Requester **and** approver principals are columns on the fork row and actors on the audit rows. No Quinn in the v1 path.                                                                                                                       |
| Extend `assistant_pending_actions` / `originRole` enum.                                                                                                                   | Not touched (would be an upstream schema edit). Fork table `fork_account_action_requests` with its own status enum.                                                                                                                             |
| Pending actions need exactly one parent → People-profile actions impossible.                                                                                             | Moot: D-A12 makes actions **ticket-only**; `ticket_id` is required at insert.                                                                                                                                                                  |
| Proposals posted as Quinn and counted in copilot analytics.                                                                                                               | Own panel/approval card (`components/fork/account-actions/`); nothing written to `assistant_pending_actions` / `assistant_tool_calls`. Ticket notes written as the human.                                                                     |
| Idempotency key tied to `latestCustomerMessageId`; tool-call key unique forever.                                                                                          | Client-generated `client_request_id` (unique); execution claimed by a conditional status UPDATE; outbound `Idempotency-Key: <request id>`.                                                                                                      |
| `AuditEventType` closed union (`audit/log.ts:44`); `recordAuditEvent` swallows failures.                                                                                  | One fenced union block (A-1). State transitions use `recordAuditEventInTransaction` (`audit/log.ts:260`) in the same tx as the row update.                                                                                                     |
| Webhook backend is fire-and-forget; integrations registry needs per-app code.                                                                                            | A **synchronous**, contract-defined HTTP API per app (§4.3) — same signing scheme as outgoing webhooks, request/response semantics, no per-app code.                                                                                            |
| Approval routing unspecified.                                                                                                                                             | D-A11: the request escalates the ticket (30's `escalateTicket`, `source: 'account_action'`); approvers learn via native `ticket_assigned`.                                                                                                     |
| Remote schema may change between request and approval.                                                                                                                    | Definitions snapshot `input_schema_hash` + `min_tier`; approval re-validates inputs against the current definition (§4.6).                                                                                                                    |
| Quinn may invoke actions (open).                                                                                                                                          | D-A7: per-workspace opt-in, off by default, **later phase** (§4.9). v1 humans only.                                                                                                                                                           |

## 2. Requirements

| #   | Requirement                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Admins register **connected apps** (base URL + signing secret) and **sync** the actions each app advertises; they may add actions manually, enable/disable them and override `min_tier` (D-A6, D-A9). |
| R2  | An agent **runs** an action directly iff they hold `account.execute` **and** `effectiveTier ≥ min_tier` (D-A8).                                                                              |
| R3  | Otherwise, an agent holding `account.request` files a **request**; the ticket escalates to the lowest tier ≥ `min_tier` (D-A11); an eligible approver approves → the action executes.        |
| R4  | Approver: holds `account.execute`, effective tier ≥ `min_tier`, on the owning tier's team (D-A3, fallback until team-scoped RBAC); **requester ≠ approver** (D-A2); Owner/Admin break-glass (D-A10). |
| R5  | Actions only from a **ticket** (D-A12). The customer is the ticket requester; the app resolves its own account from the identity we send (D-A5).                                               |
| R6  | Requests expire after **72 h**; the requester is notified (D-A13).                                                                                                                             |
| R7  | Every request / decision / execution / expiry audited with the human actor(s); full history in the fork table (no retention prune).                                                           |
| R8  | Idempotent under double-click, retry and concurrent approvals; ambiguous external outcomes surface as **unknown**, never silently retried.                                                    |
| R9  | Fork-only, minimal seams, passes module-state/authz-matrix guardrails, works under `single` and `pooled` tenancy.                                                                              |

## 3. Non-goals (v1) and independent items

- Quackback-native identity operations (2FA reset, sign-out, block) — D-A1.
- Quinn/AI invocation (later phase, §4.9), REST API and MCP exposure of account actions.
- MCP connectors as a backend (D-A9). A later `backends/connector.ts` could map a definition to a connector tool
  (`getConnector` / `openConnectorSession` / `jsonSchemaToZod`, as v1 described) behind the same state machine.
- Ticketless actions (People profile, back-office tickets) — D-A12.
- Carrying credentials: input schemas may not declare secrets (§4.3); the app delivers invites/passwords itself.
- **Independent upstream PR (D-A14, D1 exception):** add a target guard to `adminResetTwoFactorFn`
  (`functions/admin-reset-two-factor.ts:29-32`) and `forceSignOutUserFn` (`functions/admin.ts:289-299`) — both gated only
  by `auth.manage` with no target checks — rejecting the owner and higher-ranked roles, in the style of `assertBlockable`
  (`domains/principals/blocking.ts:26`). Offered upstream; not a seam and not a phase of this plan.

## 4. Design

### 4.1 Module layout (all fork-owned)

```
packages/db/src/fork/schema/account-actions.ts     fork_connected_apps, fork_account_action_definitions, fork_account_action_requests
packages/db/drizzle-fork/NNNN_account_actions.sql
apps/web/src/lib/shared/fork/account-actions/      contract.ts (zod for the app API), input-schema.ts (restricted JSON-Schema subset → zod), DTOs, status enum
apps/web/src/lib/server/fork/account-actions/
  apps.service.ts        connected-app CRUD, secret handling, sync (advertise → upsert definitions)
  client.ts              signed calls to the app API (advertise, execute)
  authorize.ts           executeTier / canRunDirect / canApprove (D-A2/3/8/10)
  identity.ts            customer identity payload from the ticket requester (§4.4)
  state-machine.ts       request / approve / reject / cancel / execute / resolve / expire (tx + audit)
  routing.ts             escalation target + escalateTicket call (§4.7)
  expiry-sweep-queue.ts  job handler: expire + notify, settle stuck executions (§4.8)
  functions.ts           server fns (requireAuth-gated)
apps/web/src/components/fork/account-actions/      slot, panel, action dialog, approval card, queue, settings page
apps/web/src/routes/admin/fork-account-requests.tsx
apps/web/src/routes/admin/settings.fork-account-actions.tsx   (registered in nav via F-4)
```

No module-level mutable state; config and definitions are read per request.

### 4.2 Connected apps and the action catalogue (D-A6, D-A9)

- **Connected app** (`fork_connected_apps`): name, `base_url`, signing secret, enabled, identity-attribute allow-list,
  last sync status. The secret is generated by us (same shape as webhook secrets, `domains/webhooks/webhook.service.ts:31-32`,
  `whsec_…`), shown once, and stored with `encrypt(secret, 'fork-connected-app-secrets')` (`lib/server/encryption.ts:113,149`)
  — the same purpose-keyed scheme as `encryptWebhookSecret` (`domains/webhooks/encryption.ts:14-23`), with its own purpose
  string. Rotation = generate new, show once, overwrite. `base_url` is checked with `checkUrlSafety`
  (`content/ssrf-guard.ts:165`) on save.
- **Action definitions** (`fork_account_action_definitions`): one row per `(app, action_key)`, `source = 'advertised' |
  'manual'`.
  - **Sync** (admin button, and on app save): `GET {base}/quackback/actions` → validate with the contract zod → upsert:
    new keys inserted **disabled** with `min_tier = clamp(suggested_min_tier)`; existing advertised rows get label,
    description, `input_schema`, `suggested_min_tier`, `risk` refreshed, **admin's `enabled` / `min_tier` kept**; keys no
    longer advertised get `missing_since` set and are disabled. Manual rows are never touched by sync.
  - **Manual**: admin enters key, label, description, `input_schema` (form builder over the §4.3 subset, or JSON) and
    `min_tier` — for apps that implement execute but not advertise.
  - Admin edits (`enabled`, `min_tier`) and syncs are audited (`account_action.config_changed`).
- Adding an action = the app advertises it (or an admin adds it) and an admin enables it. **No code, key or migration.**

### 4.3 The Quackback Account Actions API (contract v1, implemented by each connected app)

Transport: HTTPS via `safeFetch` (`content/ssrf-guard.ts:266`: IP-pinned, never follows redirects, capped body) with
`timeoutMs: 10000`, `maxResponseBytes: 65536` (advertise) / `16384` (execute), `onOverflow: 'error'`.

**Signing** — identical to outgoing webhooks (`events/handlers/webhook.ts:93-104`):
`X-Quackback-Signature: sha256=hex(HMAC_SHA256(secret, "<ts>.<body>"))`, `X-Quackback-Timestamp: <unix s>`,
`X-Quackback-Event`, plus `X-Quackback-Contract: 1`. For `GET`, `<body>` is the empty string. Receivers **must** verify
the signature (constant-time) and reject timestamps older than 5 minutes.

**Advertise** — `GET {base}/quackback/actions` (`X-Quackback-Event: account_action.advertise`) → `200`:

```jsonc
{
  "contract": 1,
  "actions": [
    {
      "key": "unlock_account",            // ^[a-z][a-z0-9_]{0,63}$, unique per app
      "label": "Unlock account",
      "description": "Clears the lockout after failed sign-ins.",
      "input_schema": { "type": "object", "properties": { "reason": { "type": "string", "maxLength": 500 } }, "required": [] },
      "suggested_min_tier": 1,             // integer, clamped to 1..9
      "risk": "low"                        // "low" | "medium" | "high" (display + default ordering only)
    }
  ]
}
```

`input_schema` is a **restricted subset**: a flat `object` whose properties are `string` (optional `enum`, `maxLength`,
`format: "email"`), `integer`/`number` (optional `minimum`/`maximum`), or `boolean`; `required` list; `title`/
`description` for labels. Anything else (nested objects, arrays, `writeOnly`, `format: "password"`, property names
suggesting secrets) is rejected at sync/save and the action is stored as invalid-disabled. A fork-owned
`input-schema.ts` compiles the subset to a strict zod object; upstream `jsonSchemaToZod`
(`domains/assistant/connectors/connector-tools.ts:38`) is **not** reused — it is lenient (no `enum`, non-strict objects).

**Execute** — `POST {base}/quackback/actions/{key}` (`X-Quackback-Event: account_action.execute`,
`Idempotency-Key: <request id>`), body:

```jsonc
{
  "id": "<request uuid>", "action": "unlock_account", "requested_at": "…",
  "customer": {                           // §4.4 — the app resolves its own account (D-A5)
    "email": "…", "name": "…", "quackback_principal_id": "principal_…",
    "external_user_id": "…|null", "attributes": { /* allow-listed only */ }
  },
  "inputs": { "reason": "…" },
  "actor": {
    "requested_by": { "principal_id": "…", "email": "…", "name": "…" },
    "approved_by": { "principal_id": "…", "email": "…", "name": "…" } | null,
    "mode": "direct" | "approved", "break_glass": false
  },
  "ticket": { "id": "ticket_…" }
}
```

Response → outcome mapping:

| Response                                                                                  | Settles as                                    |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `200 {"status":"succeeded","message"?,"result"?}`                                         | `succeeded`                                   |
| `200 {"status":"failed","message"?}`                                                      | `failed` / `APP_FAILED`                       |
| `200 {"status":"customer_not_found" \| "customer_ambiguous","message"?}`                  | `failed` / `CUSTOMER_NOT_RESOLVED`            |
| `409` (already processed this `Idempotency-Key`; body = the original response)            | the original response's outcome               |
| other `4xx`, unparseable `2xx`, `SsrfError` (never left the host)                         | `failed`                                      |
| `5xx`, timeout, connection reset, `ResponseTooLargeError`                                  | `unknown` (never auto-retried)                |

`message`/`result` are untrusted: stored as capped plain-text `result_summary` (≤ 2 KB, `result` JSON-stringified) and
rendered as text only. The fork ships the contract as zod schemas plus a stub receiver used in tests; a short
implementer guide lives in `plans/` (never `docs/`).

### 4.4 Customer identity (D-A5)

The customer is the anchor ticket's `requester_principal_id` (`packages/db/src/schema/tickets.ts:110`). Actions are
unavailable (panel explains why) when the ticket has no requester, the requester is a team member or service principal
(`isTeamMember`, `lib/shared/roles.ts:53` — prevents acting on colleagues or oneself), or the requester has no email.

Payload fields, read at execution time (not stored on the request row):

- `email`, `name` — from `user` via the principal.
- `external_user_id` — `user.external_id` (`schema/auth.ts:176`, unique `:196-198`), set only by the **verified widget
  identify** path from the JWT `sub` (`routes/api/widget/identify.ts:247`); else `metadata._externalUserId`, written by the
  REST identify path (`domains/users/user.identify.ts:73-80`, key `EXTERNAL_ID_KEY` `user.attributes.ts:32`, reader
  `extractExternalId` `:58`); else `null`.
- `attributes` — `user.metadata` custom attributes (merged at identify time: widget `identify.ts:229-234,301`, REST
  `user.identify.ts:73-81`; parsed by `parseUserAttributes` `user.attributes.ts:43`), **filtered to the app's
  `identity_attribute_keys` allow-list** (default empty) so one app never receives attributes meant for another.

The app resolves its own account and answers `customer_not_found` / `customer_ambiguous` when it cannot.

### 4.5 Authorization (D-A2, D-A3, D-A8, D-A10, D-A4)

Tier data comes from 30: `fork_team_tiers` (tiers 1..9 on teams) and a helper
`listTierMemberships(principalId) → [{ teamId, tier }]` over `team_members` ⨝ `fork_team_tiers` (non-deleted teams);
30's `effectiveTier` = max of that list.

- **`executeTier(actor)`** = max `tier` over the actor's tier memberships where the actor holds `account.execute` for
  that team: workspace-wide `can(actor, 'account.execute')` (`policy/authorize.ts:21`), or — once 10's team-scoped RBAC
  lands — `canInTeam(actor, 'account.execute', teamId)`. Null if none.
- **Run directly** iff `executeTier(actor) ≥ def.min_tier`. **Owner/Admin** (hold every key) may run directly even
  without a qualifying membership; that run is flagged `break_glass` and audited (§10 A-Q3).
- **Request** iff the actor holds `account.request` and cannot run directly. Actor must be able to see the ticket
  (`assertTicketVisible`, `ticket.service.ts:115`).
- **Approve** (`canApprove(actor, request)`), all of:
  1. `actor ≠ requested_by` — always, including Owner/Admin (D-A2, D-A10); also a DB check.
  2. **D-A3 target team**: with team-scoped RBAC, `canInTeam(actor, 'account.execute', request.approver_team_id)`;
     fallback until then, `can(actor, 'account.execute')` **and** membership of `approver_team_id`.
  3. **D-A8 tier**: the team's tier ≥ `max(request.min_tier_at_request, def.min_tier)` (implied by 2 when routing
     picked a qualifying team; re-checked because an admin may have raised `min_tier` since).
  4. Else **Owner/Admin break-glass** (D-A10): allowed, `approval_mode='break_glass'`, audit `metadata.breakGlass=true`.
- **Managers** hold neither key (D-A4), so they can neither run, request nor approve.

### 4.6 State machine

```
            request (account.request, tier < min)                      approve (§4.5)
 [none] ───────────────────────────────────▶ pending_approval ─────────────────▶ executing ──▶ succeeded
   │                                            │  │  │                              │   ├──▶ failed
   │ run (execute, tier ≥ min)                   │  │  └─ reject ─▶ rejected          │   └──▶ unknown ─▶ (resolve) succeeded|failed
   └─────────────────────────────────────────────┼──┼──────────────────────────▶ executing
                                                 │  └─ cancel (requester) ─▶ cancelled
                                                 └─ expires_at ≤ now (sweeper / read) ─▶ expired
```

- **Run**: insert `status='executing'`, `requested_by = approved_by = actor`, `approval_mode='self'` (or `'break_glass'`).
- **Request**: insert `pending_approval`, `expires_at = requested_at + 72 h` (constant `REQUEST_TTL_HOURS`, D-A13), then
  route (§4.7) and add a ticket note as the requester.
- **Approve**: one tx — `UPDATE … SET status='executing', approved_by_principal_id=…, approval_mode=…, decided_at=now()
  WHERE id=? AND status='pending_approval' AND expires_at > now() RETURNING *`; zero rows ⇒ 409 (decided/expired).
  Re-validation first (below). Approve and reject add a ticket note **as the approver** — the requester is a watcher
  after escalation (D-T2), so native `ticket_note_added` notifies them (`events/targets.ts:994-1020`: agent watchers,
  actor excluded).
- **Execute** (both paths): tx1 = state → `executing` + `recordAuditEventInTransaction` (`account_action.requested` /
  `.approved`); external call outside any tx; tx2 = settle + `account_action.executed` audit (outcome success/failure).
- **Stuck `executing`** (process died): the sweeper settles `execution_started_at < now() − 5 min` to `unknown`; reads
  derive the same so a lagging sweeper is harmless. `unknown` offers "Mark resolved (succeeded/failed)" to an
  `account.execute` holder with sufficient tier (not the requester for approved requests), audited.
- **Retry after `failed`/`expired`/`rejected`**: new request with `retry_of_request_id`; rows are never re-executed.
- **Idempotency**: `client_request_id` (uuid, created when the dialog opens) is unique; a replayed submit returns the
  existing row. Outbound `Idempotency-Key` = row `id`.

**Re-validation at approval** (definition read fresh): app or definition disabled/missing → `failed` /
`CONFIG_CHANGED`; `input_schema_hash` differs → re-parse stored `inputs` with the current schema, failure →
`failed` / `INPUT_CONTRACT_CHANGED` (the approval card warns beforehand); `min_tier` raised → the §4.5 tier check uses
the higher value.

### 4.7 Routing (D-A11, D-A3, integration with 30)

On request, `routing.ts`:

1. **Target tier** = the lowest tier ≥ `def.min_tier` that has at least one team.
2. **Target team** = walk `escalates_to_team_id` edges from the ticket's current team (30 §4.1) to the first team with
   tier ≥ `min_tier`; if none on the path, the unique team at the target tier; if several, the requester picks in the
   dialog. If the ticket **already sits** on a team with tier ≥ `min_tier`, no escalation — that team is the approver team.
3. Call 30's `escalateTicket({ subject: { ticketId }, toTeamId, reason: 'access_required', note, expectedFromTeamId },
   actor, { source: 'account_action' })`. Per 30 §11 it performs no permission check of its own beyond the from-team
   scope; 40 authorizes with `account.request`. It returns the `fork_support_escalations.id`, stored on the request.
   Effects (30): ticket and paired conversation move, the requester is cleared and watches (D-T2), SLA carries (D-T1), the
   distributed agent gets native `ticket_assigned`.
4. `approver_team_id` is stored on the request (D-A3 anchor).

Conversations: the panel works on a ticket, or a conversation paired with a ticket (`getLinkedCustomerTicket`,
`inbox/inbox.query.ts:647`). A ticket-less conversation shows "Convert to a ticket to use account actions" (native
convert) — D-A12.

### 4.8 Expiry and notification (D-A13)

A fork job `fork-account-actions-sweep` (cron `*/5 * * * *`, `maxAttempts: 3`, with a `cronEnabled` gate that is true only
when a `pending_approval`/`executing` row exists — same pattern as `sla-breach-sweep`, `jobs/definitions.ts:203-216`)
registered via seam **A-5**:

- `UPDATE … SET status='expired' WHERE status='pending_approval' AND expires_at <= now() RETURNING *` (one tx with
  `account_action.expired` audit, actor type `system`, `audit/log.ts:164`).
- For each expired row, notify the requester: `createNotification` (`domains/notifications/notification.service.ts:74`)
  with the **existing** type `ticket_note_added` (title "Account action request expired: {label}", metadata
  `{ ticketId, audience: 'admin' }`), avoiding a new `NotificationType` (closed union `notification.types.ts:12`, 4 seams).
  No ticket note (a note needs an agent principal, `ticket-message.service.ts:481-486`).
- Settle stuck `executing` rows to `unknown` (§4.6).
- The ticket stays on the approver tier after expiry/rejection; de-escalation is 30's normal flow.

### 4.9 Quinn access (D-A7) — later phase, not v1

v1 exposes no assistant tool. Later, gated by `fork_settings.account_actions.quinnEnabled` (default **false**, per
workspace):

- **Seam A-6 (deferred):** spread fork specs into the `extraSpecs` argument of `assembleAssistantToolset` at
  `domains/assistant/assistant.runtime.ts:1085-1088` (`[...workspaceMcpSpecs, ...connectorSpecs, ...forkSpecs]`). Extra
  specs always ride the execution pipeline (`assistant.tools.ts:416-423`) and `resolveEffectiveToolMode`
  (`assistant.tools.ts:90-96`) honours `approvalPolicy: 'approval'` → propose.
- Quinn has no tier, so every Quinn invocation is a **request** (never a direct run) and a human approver completes it
  under §4.5. Open design point for that phase: approved pending actions are attributed to Quinn upstream, so the fork
  spec's `execute` must hand off to this plan's state machine with Quinn recorded as requester and the human as
  approver, rather than execute inside the Quinn pipeline.

### 4.10 UI

- **Account actions panel** (`account-actions-panel.tsx`) via `<ForkAccountActionsSlot item />` in the inbox detail
  panel after `<CompanyCard>` (`inbox-detail-panel.tsx:467`; co-located with 30's `ForkTierPanel` slot, T-2). Lists enabled
  apps and their enabled actions with a tier badge; per action **Run**, **Request…** (with target tier shown), or disabled
  with the reason ("needs Tier 2"). Renders nothing when the feature is off or the viewer holds neither key.
- **Action dialog**: form generated from `input_schema` (§4.3 subset); shows what identity will be sent.
- **Approval card**: requester, customer, app, action, inputs, age/expiry, schema/tier-changed warnings; Approve / Reject
  (reason). Shown in the panel for the ticket's pending requests and on `/admin/fork-account-requests` (filters: "I can
  approve", "I requested").
- **Settings page** `/admin/settings/fork-account-actions` (registered via **F-4**, gated `integration.manage`): connected
  apps (URL, secret generate/rotate, attribute allow-list, enable), **Sync** + last result, action table (enable,
  `min_tier`, source, risk, missing/invalid badges), manual action editor, "Test connection" (= signed advertise call).

## 5. Data model (fork lineage, `packages/db/drizzle-fork/`)

### 5.1 `fork_connected_apps`

| Column                                            | Type                                   | Notes                                                    |
| ------------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| `id`                                              | uuid PK                                |                                                          |
| `name`                                            | text NOT NULL                          |                                                          |
| `base_url`                                        | text NOT NULL                          | https; SSRF-checked on save and call                     |
| `secret_ciphertext`                               | text NOT NULL                          | `encrypt(…, 'fork-connected-app-secrets')`; never returned |
| `enabled`                                         | boolean NOT NULL default false         |                                                          |
| `identity_attribute_keys`                         | text[] NOT NULL default `'{}'`         | allow-list for `customer.attributes`                     |
| `last_sync_at`, `last_sync_status`, `last_sync_error` | timestamptz / text / text          | `ok` \| `error` \| `never`                               |
| `created_by_principal_id`                         | typeid principal NULL FK SET NULL      | staff                                                    |
| `created_at`, `updated_at`                        | timestamptz                            |                                                          |

### 5.2 `fork_account_action_definitions`

| Column                              | Type                                      | Notes                                                        |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `id`                                | uuid PK                                   |                                                              |
| `app_id`                            | uuid NOT NULL FK → `fork_connected_apps` ON DELETE RESTRICT | apps are disabled, not deleted, once used   |
| `action_key`                        | text NOT NULL                             | `^[a-z][a-z0-9_]{0,63}$`; path segment of the execute URL     |
| `label`, `description`              | text NOT NULL / text                      |                                                              |
| `input_schema`, `input_schema_hash` | jsonb NOT NULL / text NOT NULL            | §4.3 subset; canonical-JSON sha256                           |
| `min_tier`                          | smallint NOT NULL check 1..9              | admin-controlled; UI offers T1–T3 by default (30's range)    |
| `suggested_min_tier`, `risk`        | smallint NULL / text NULL                 | as advertised                                                |
| `enabled`                           | boolean NOT NULL default false            |                                                              |
| `valid`                             | boolean NOT NULL default true             | false if the advertised schema is outside the subset          |
| `source`                            | text NOT NULL check `IN ('advertised','manual')` |                                                       |
| `missing_since`                     | timestamptz NULL                          | no longer advertised                                         |
| `updated_by_principal_id`           | typeid principal NULL FK SET NULL         | staff                                                        |
| `updated_at`                        | timestamptz                               |                                                              |

Unique `(app_id, action_key)`. No endpoint-path column: the contract fixes `/quackback/actions/{key}` (§10 A-Q6).

### 5.3 `fork_account_action_requests`

| Column                                                                            | Type                                          | Notes                                                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `id`                                                                              | uuid PK                                       | also the outbound `Idempotency-Key`                                   |
| `client_request_id`                                                               | uuid NOT NULL UNIQUE                          |                                                                       |
| `app_id`, `definition_id`                                                         | uuid NOT NULL FK RESTRICT                     |                                                                       |
| `action_key`, `action_label`                                                      | text NOT NULL                                 | snapshots for history                                                 |
| `min_tier_at_request`, `input_schema_hash`                                        | smallint / text NOT NULL                      | snapshots for §4.6                                                    |
| `ticket_id`                                                                       | typeid ticket NULL FK SET NULL                | required at insert (app check); nullable only so ticket hard-deletes aren't blocked |
| `customer_principal_id`                                                           | typeid principal NULL FK SET NULL             | ticket requester at request time; **re-pointed on merge** (F-5)       |
| `escalation_id`, `approver_team_id`                                               | uuid NULL / typeid team NULL                  | → `fork_support_escalations.id` (30); D-A3 anchor                     |
| `inputs`                                                                          | jsonb NOT NULL                                | validated inputs (no secrets)                                         |
| `status`                                                                          | text NOT NULL                                 | check `IN ('pending_approval','rejected','cancelled','expired','executing','succeeded','failed','unknown')` |
| `approval_mode`                                                                   | text NULL                                     | `self` \| `approved` \| `break_glass` \| `rejected`                   |
| `requested_by_principal_id`, `requester_tier`                                     | typeid principal NOT NULL FK RESTRICT / smallint NULL | staff                                                         |
| `approved_by_principal_id`                                                        | typeid principal NULL FK RESTRICT             | staff                                                                 |
| `decision_reason`                                                                 | text NULL                                     | reject reason / resolve note                                          |
| `requested_at`, `expires_at`, `decided_at`, `execution_started_at`, `settled_at`  | timestamptz                                   | `expires_at` NULL for direct runs                                     |
| `result_summary`, `error_code`                                                    | text NULL                                     | capped, untrusted text                                                |
| `retry_of_request_id`                                                             | uuid NULL self-FK                             |                                                                       |

Checks: `approval_mode NOT IN ('approved','break_glass') OR approved_by_principal_id <> requested_by_principal_id`
(D-A2, D-A10); `status <> 'pending_approval' OR (expires_at IS NOT NULL AND ticket_id IS NOT NULL)`. Indexes: partial
`(expires_at) WHERE status='pending_approval'` (queue + sweep); partial `(execution_started_at) WHERE status='executing'`;
`(ticket_id, requested_at DESC)`; `(requested_by_principal_id, requested_at DESC)`; `(approver_team_id) WHERE
status='pending_approval'`. No retention prune (R7).

**Principal references (`02-…` §8):** `customer_principal_id` re-points on merge (fork step via F-5); staff columns
(`requested_by`, `approved_by`, `created_by`, `updated_by`) are declared exemptions.

## 6. Permissions

### 6.1 Keys (fork block via F-7, category `support`)

| Key               | Meaning                                                                                  | Owner/Admin | Manager (D-A4)                          | Contributor | Seeded roles (10-rbac)          |
| ----------------- | ---------------------------------------------------------------------------------------- | ----------- | --------------------------------------- | ----------- | ------------------------------- |
| `account.request` | File a request for an action above the holder's tier; cancel own requests                | ✅          | ❌ (in `WORKSPACE_ADMIN_PERMISSIONS`)   | ❌          | Tier 1, Tier 2, Tier 3 Agent    |
| `account.execute` | Run actions with `min_tier ≤` holder's tier; approve requests at or below it; resolve `unknown` | ✅    | ❌                                      | ❌          | Tier 1, Tier 2, Tier 3 Agent    |

Tiering comes from team membership and `min_tier`, not from which key a role holds — the same two keys serve every tier
role. Team-scoped grants (10, `TEAM_SCOPABLE_PERMISSIONS`) apply to both. API-key scope: `support` → `write:chat`; no
REST/MCP surface. Fleet Agent / Fleet Observer (20) get neither.

### 6.2 Enforcement (`lib/server/fork/account-actions/functions.ts`)

| Server fn                                                                                               | Static gate          | Domain check                             |
| ------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------- |
| `getAccountActionsPanelFn`, `listAccountRequestsFn`                                                     | `ticket.view`        | ticket visibility; filters by capability |
| `requestAccountActionFn`, `cancelAccountRequestFn`                                                      | `account.request`    | tier < min, own request for cancel       |
| `runAccountActionFn`, `decideAccountRequestFn`, `resolveUnknownAccountActionFn`                         | `account.execute`    | §4.5                                     |
| `listConnectedAppsFn`, `upsertConnectedAppFn`, `rotateConnectedAppSecretFn`, `syncConnectedAppFn`, `testConnectedAppFn`, `updateActionDefinitionFn`, `upsertManualActionFn` | `integration.manage` (admin-only, `rbac-catalogue.ts:626`) | SSRF + schema subset |

Domain functions re-check `can()`; the fns are thin wrappers so the domain is the single enforcement point.

## 7. Seams

Shared seams used, not counted here: **F-4** (settings page), **F-5** (re-point `customer_principal_id`), **F-7** (two keys).

| ID  | Upstream file                                                        | Change (one line)                                                                                                   | Why unavoidable                                           | Re-apply on conflict                                                      |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| A-1 | `apps/web/src/lib/server/audit/log.ts`                               | `FORK-SEAM(account-actions)` union members `account_action.requested/approved/rejected/cancelled/expired/executed/resolved/config_changed` | `AuditEventType` is a closed union (`:44`)               | Take upstream; re-append the fenced block at the end of the union (next to N-4). |
| A-2 | `apps/web/src/components/admin/inbox/inbox-detail-panel.tsx`         | Import + `<ForkAccountActionsSlot item />` after `<CompanyCard>` (`:467`), co-located with T-2                       | No extension point in the panel                           | Re-insert after the `CompanyCard` render wherever it moved.               |
| A-5 | `apps/web/src/lib/server/jobs/definitions.ts`                        | `...FORK_JOB_DEFINITIONS` spread at the end of `JOB_DEFINITIONS` (`:154`) → `fork-account-actions-sweep`            | D-A13 expiry notification needs a scheduler; job list is a static array | Re-add the spread as the last element (candidate shared F-8, A-Q2).   |
| A-4 | _Optional_ `components/admin/settings/security/audit-log-page.tsx`   | Spread fork event labels into the filter list                                                                        | Filter dropdown is curated; feed shows rows anyway        | Re-add the spread. Skip if seam budget is tight.                          |
| A-6 | _Deferred (D-A7 phase)_ `lib/server/domains/assistant/assistant.runtime.ts` | `...forkAssistantSpecs` in the `extraSpecs` array (`:1085-1088`)                                              | Assistant tool set is assembled in one call site          | Re-add the spread to the array.                                           |

Removed: old **A-3** (`users/user-detail.tsx` People-profile slot, D-A12); settings-nav entry (now F-4); catalogue keys
(now F-7). Generated: `lib/shared/permissions.ts` (`db:permissions`), `policy/authz-matrix/MATRIX.md` (14 gated fns),
`policy/dep-graph/GRAPH.md`.

**Count (v1 core): 3 hand seams** (A-1, A-2, A-5) + 1 optional (A-4) + 1 deferred (A-6). A-5 drops to 0 if Foundations
adopts it as a shared seam.

## 8. Phases

| Phase                               | Deliverable                                                                                                               | Validation gate                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Prerequisites**                | Foundations (lineage, F-4/F-5/F-7); 10 keys block + tier roles; 30 `fork_team_tiers`, `listTierMemberships`, `escalateTicket` | Fork drift check green; tier roles seeded with `account.request` + `account.execute`                                                                                                                         |
| **1. Keys, schema, connected apps** | 2 keys (Manager-excluded); 3 tables + migration; re-point registry entry; apps CRUD, secret generate/rotate, sync, manual actions, settings page | `db:permissions` diff = 2 keys; Manager lacks both; journal-integrity test; sync against stub receiver upserts/disables correctly and keeps admin overrides; subset validator rejects nested/secret fields; unsafe URL rejected |
| **2. Direct run**                   | `client.ts` execute; `authorize.ts` (`executeTier`); state machine run path; identity payload; audit in tx                | Stub receiver verifies HMAC + timestamp; outcome table §4.3 (incl. 409 replay, timeout → `unknown`); T2 member runs `min_tier=2`, T1 member gets 403; double-submit same `client_request_id` = one call      |
| **3. Request → approve**            | Request/approve/reject/cancel; routing + `escalateTicket`; D-A2 check; D-A3 fallback; break-glass; re-validation          | T1 requests `min_tier=2` → ticket on T2, T1 watches → T2 member approves → executes, both recorded; self-approve 403 (incl. Owner); non-team T2 403; Owner off-team approves with `break_glass`; concurrent approvals → 200 + 409; schema change → `INPUT_CONTRACT_CHANGED`; ticket already on T3 → no escalation |
| **4. Expiry**                       | Seam A-5, sweep job, notification, stuck-execution settle                                                                 | Request at `expires_at` is `expired` within one cron tick; requester gets one notification; approve after expiry → 409; stuck `executing` → `unknown`                                                        |
| **5. UI**                           | Slot A-2, panel, dialog, approval card, queue page                                                                        | Manual GUI walkthrough on ticket and paired conversation; unpaired conversation shows convert hint; panel invisible when off or keyless                                                                        |
| **6. Team-scoped approver**         | Switch `executeTier`/`canApprove` to 10's `canInTeam` when available                                                      | `account.execute` granted only on the T2 team → approves T2-routed requests, not T3's; leaving the team revokes                                                                                                 |
| **7. (Later) Quinn, D-A7**          | `quinnEnabled` flag (default off), seam A-6, request-only spec handing off to the state machine                           | Flag off: no spec in the assembled tool set; flag on: Quinn can only create requests; human approver recorded                                                                                                  |

## 9. Testing strategy

- **Unit**: state transitions table-driven (every from/to incl. illegal); `executeTier` / `canApprove` matrix (roll-up across
  several memberships, requester, Owner break-glass, member without key, key without membership, raised `min_tier`);
  customer guard (team member, service principal, no email, no requester); input-schema subset compiler; sync merge rules.
- **Contract**: zod contract schemas; a stub receiver that verifies the signature and timestamp exactly as an implementer
  would; response mapping table; identity payload (widget `external_id` vs REST `_externalUserId` precedence; attribute
  allow-list filtering).
- **DB tests**: conditional-UPDATE race; unique `client_request_id`; D-A2 check; audit row iff state change committed;
  sweeper expiry + stuck-execution settle; `customer_principal_id` re-point on principal merge (fork completeness test).
- **Security**: SSRF (private IP at save and at call), no redirect follow, response cap, secret never in DTOs or logs.
- **Guardrails**: authz-matrix snapshot, module-state scan, permissions mirror, dep-graph, `single` + `pooled` runs.
- **Regression**: no rows in `assistant_pending_actions` / `assistant_tool_calls` after an account action; 30's escalation
  tests unaffected by `source: 'account_action'`.
- **Manual**: recorded walkthrough — T1 direct run, T1 request → T2 approve, reject, expire + notification, unknown → resolve,
  admin sync with an action removed upstream.

## 10. Open items

No `D-A*` item is open in `01-decisions.md` "Still open". New items:

| ID       | Item                                                                                                                                                                                                                             | Status              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **A-Q1** | Expiry notification reuses the existing `ticket_note_added` notification type via `createNotification` (0 seams) rather than a new `NotificationType` (4 seams). Acceptable, or is a dedicated type wanted?                         | 🟡 adopted          |
| **A-Q2** | Seam A-5 (`jobs/definitions.ts` fork job spread) — promote to a shared Foundations seam **F-8** if 30/60 also need scheduled jobs.                                                                                                  | coordinator         |
| **A-Q3** | Owner/Admin **direct run** of actions above any tier they are a member of: allowed as break-glass and audited (D-A10 covers approval only). Confirm.                                                                               | 🟡 adopted          |
| **A-Q4** | Newly advertised actions arrive **disabled** until an admin enables them. Confirm (alternative: enabled at the suggested tier).                                                                                                   | 🟡 adopted          |
| **A-Q5** | Identity attributes sent to an app are an explicit per-app allow-list (default none). Confirm privacy default.                                                                                                                    | 🟡 adopted          |
| **A-Q6** | Shared-name list mentions an "endpoint path" per definition; this plan fixes the path by contract (`/quackback/actions/{key}`) and stores none. Add a per-definition path override only if an app cannot follow the contract.   | coordinator         |
| **A-Q7** | Cross-plan (30): expose `listTierMemberships(principalId)` (not only a scalar `effectiveTier`) so team-scoped `account.execute` can be filtered per team; and align 30 §4.2 step 3 (authorizes `ticket.escalate`) with the §11 contract (caller authorizes; `source: 'account_action'`). | cross-plan          |
| **A-Q8** | Cross-plan (10): replace `account.unlock` / `account.create` with `account.request` / `account.execute` in the Tier role table, `TEAM_SCOPABLE_PERMISSIONS` and §6 key table; all three Tier roles get both keys.                 | cross-plan          |

## 11. Relationship to other v2 plans

- **10-rbac-persona-extensions** — fenced key block (F-7), "Tier 1/2/3 Agent" roles carrying `account.request` +
  `account.execute`, and the team-scoped resolver `canInTeam` used by D-A3 (Phase 6 here). Needs the A-Q8 update.
- **30-tiered-support** — tiers (`fork_team_tiers`, 1..9), membership helper, `escalateTicket` with
  `source: 'account_action'` returning the escalation id (30 §11), D-T1/D-T2/D-T3 semantics. This plan is its
  account-tooling layer. See A-Q7.
- **20-control-tower** — no surface in v1. A later MCP tool would register via F-3 and inherit human attribution (D-C2).
- **50 / 60** — independent (60 shares the `AuditEventType` union block location, A-1/N-4; may share A-5 if it needs jobs).
