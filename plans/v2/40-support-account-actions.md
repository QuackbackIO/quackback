# Support Account Actions (Connected-App Actions) — v2 Design Plan

> **Status:** v2 (round-2 revision + staff review + intranet revision 2026-09-19) — supersedes `plans/v1/support-account-actions-plan.md`. Planning only; nothing implemented.
> **Depends on:** Foundations (fork lineage, `fork_settings`, shared seams F-4/F-5/F-7/F-8/F-9, `02-fork-conventions.md` §3, §8, §10, §11a);
> **shared seam F-12** (SSRF allow-list `SSRF_ALLOWED_CIDRS` / `SSRF_ALLOWED_HOSTS`, `04-intranet-deployment.md` E-1) —
> without it every connected app (an intranet host) is rejected by the SSRF guard;
> `10-rbac-persona-extensions.md` (fork key block, "Tier N Agent" roles, and — **before any runnable phase here** — Phase 2
> team-scoped resolver `canInTeam`, because `account.*` is team-scoped only);
> `30-tiered-support.md` (`fork_team_tiers`, `escalateTicket` contract §11, tier-membership helper).
> **Decisions applied:** D1, D2, D4 · D-A1 … D-A14 (all ✅) · D-T2, D-T3 (routing) · D-R2 (2-part keys) · D-E1 … D-E6 (intranet).
> **Goal:** From a ticket, support agents run **actions defined by the company's internal connected apps** (unlock,
> create, and whatever else an app advertises) against the ticket requester's account in that app. The requester is
> always an SSO-authenticated employee (D-E4); "customer" below means that employee. Each action has a **minimum tier**;
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
| Requests expire after **72 h** (constant) and the requester is **notified** → needs a sweeper job (now shared seam F-8).                                                                      | D-A13          |
| Owner/Admin break-glass approval (audited, never self-approval); Managers excluded; requester ≠ approver; approver on the owning tier's team (interim fallback later removed, staff review A1) — all now ✅. | D-A10, D-A4, D-A2, D-A3 |
| Quinn access described as a **later, per-workspace, off-by-default** phase (seam A-5, deferred); v1 is humans only.                                                                           | D-A7           |
| 2FA-reset / force-sign-out target guard is an **independent upstream PR**, not part of this plan's phases.                                                                                    | D-A14, D1      |
| Settings page registered through shared **F-4**; keys through **F-7**; customer principal re-point through **F-5**.                                                                            | `02-…` §10     |
| Old open items A-Q1…A-Q7 resolved by decisions or contracts; new items in §10.                                                                                                                 | —              |

## Staff-review changes

Findings from `03-staff-review.md` assigned to this plan. Body sections below are updated; superseded text removed.

| Finding ID | Change | Where in plan |
| --- | --- | --- |
| **A1** | **Team-aware authorization from the first runnable phase; no workspace-wide `can()` fallback.** `account.request` / `account.execute` are checked only via 10's `canInTeam` (workspace-wide custom-role grants are inert, 10 §4.4); Owner/Admin qualify through `canInTeam`'s system-role grant. Server fns no longer use `requireAuth({ permission: 'account.*' })` (which reads workspace permissions only and would reject a valid team-only grant): every account-action fn gates on `requireAuth({ permission: 'ticket.view' })` (dashboard session) and the domain authorizes team + tier. **Ticket visibility** (`assertTicketVisible`, `ticket.service.ts:115`, fused `ticketFilter`) is enforced on panel, request, direct run, approve, reject, cancel and unknown-outcome resolution; the queue lists only rows whose ticket passes `ticketFilter(actor)`. **Ticket moves teams after the request:** approval follows the ticket's **current** owning team; if that team's tier is below the action's `min_tier`, the request re-routes (🟡 A-Q9). Old Phase 6 ("switch to `canInTeam` later") and the D-A3 interim fallback removed (Quinn is now Phase 6); 10 Phase 2 is a Phase-0 prerequisite. | §4.5, §4.7, §6.2, §8 (Phase 0, 2, 3), §9, §10 A-Q9 |
| **A2** | **Execution mode separated from break-glass.** `execution_mode` (`direct` \| `approved`) + `break_glass boolean` + `decision` (`approved` \| `rejected`) + `decided_by_principal_id` replace `approval_mode` / `approved_by_principal_id`. Direct runs have `decided_by IS NULL` (no self-approval row shape); two-person separation (`decided_by <> requested_by`) is enforced only on decided rows. Exact row shapes (incl. null approver) are tested. | §4.3 (execute body), §4.5, §4.6, §5.3 checks, §9 |
| **A3** | **Ambiguous outcomes never become `failed`.** Malformed 2xx bodies and malformed `409` replay bodies → `unknown`. `failed` only for (a) a well-formed contract `failed`/`customer_*` result, (b) an explicit contract **rejection** (`4xx` + `{"status":"rejected","code":…}` from a fixed code list the receiver may return only before executing), or (c) a local failure before any byte was sent (`SsrfError` from the pre-connect check, or `ECONNREFUSED`). Everything else → `unknown`. Contract v1 adds a mandatory **status lookup** `GET {base}/quackback/actions/requests/{idempotencyKey}`; the sweep reconciles `unknown` rows with the **original** request id once the receiver's 5-minute timestamp window has closed; a human may resolve or re-send **under the same idempotency key**. A fresh request (new key) from an `unknown` row is refused until it is reconciled/resolved. Receiver obligations (reserve key before side effects, ≥ 30-day retention, replay semantics) are part of the contract. | §4.3, §4.6, §4.8, §9 |
| **A4** | **Durable routing, notification and identity binding.** (1) Routing is a resumable state (`routing_state`, `routing_attempt`, `routed_at`) written in the insert tx; `escalateTicket` is called with a deterministic `idempotencyKey` (30 §4.2 input); replayed submits (`client_request_id`) and the sweep **resume** unfinished routing. (2) The expiry notification is inserted by `createNotification(input, tx)` (`notification.service.ts:74-77`, accepts a `tx`) in the **same transaction** as the conditional expiry UPDATE; the one-time state transition is the dedup key and the notification id is stored on the row. (3) Approval is bound to an **identity + configuration snapshot** (`binding_snapshot` + `binding_hash`) captured at request time from server-side sources only; the approver approves a specific hash; execution sends the snapshot and re-checks the live hash — any material change (🟡 A-Q10) returns the request to review. (4) **Eligibility of cold-email requesters**: a lead principal with only `contactEmail` is **not** a target (still applies; the path to eligibility is now the requester's first **SSO** sign-in, and A-Q11 is closed — see Intranet changes I-5). The payload tells the receiver which identifiers are verified; receivers must not resolve on unverified identifiers. Customer identity is always server-derived, never caller-supplied (inputs may not carry identity fields). | §4.3, §4.4, §4.6, §4.7, §4.8, §5, §9, §10 |
| **X-2** | `min_tier` (and advertised `suggested_min_tier`) limited to **1..3** in v1, matching the three Tier templates (10) and three tier levels; DB check `BETWEEN 1 AND 3`. Widening needs a fork migration plus new Tier templates. | §4.2, §4.3, §5.2, §5.3 |
| **X-6** | Seam table aligned with `SEAMS.md` (old A-1 → F-9, old A-5 → F-8, old A-6 → A-5); resolved cross-plan notes A-Q2, A-Q6, A-Q7, A-Q8 closed/removed. | §7, §10, §11 |
| **X-7** | Quinn phase labelled deferred: v1 does **not** deliver AI-initiated requests (D-A7). | §4.9, §8 |

## Intranet changes (D-E1…D-E6)

Connected apps are intranet hosts, and every requester is an SSO-authenticated employee. Body sections below are
updated; superseded text removed.

| ID | Change | Decision | Where |
| --- | --- | --- | --- |
| **I-1** | **Shared seam F-12 is a hard prerequisite.** Upstream `checkUrlSafety` rejects any hostname that resolves to a private address (`content/ssrf-guard.ts:184-190`; IPv4 blocklist 10/8, 172.16/12, 192.168/16, 100.64/10, 127/8, 169.254/16 at `:131-145`; IPv6 ULA/link-local at `:101-129`), and `safeFetch` calls it before connecting (`:266-268`), so without F-12 every save, sync, test and execute against an intranet app fails with `SsrfError`. F-12 adds the deployment-config allow-list `SSRF_ALLOWED_CIDRS` / `SSRF_ALLOWED_HOSTS`; **loopback and link-local (incl. 169.254.169.254 instance metadata) stay blocked regardless**. This plan keeps using `checkUrlSafety` / `safeFetch` unchanged (IP pinning, no redirects, capped body) — it gains no bypass of its own. | D-E1, D-E2 | header, §4.2, §4.3, §8 Phase 0 |
| **I-2** | **Connected-app form validates the base URL against the allow-list with a clear error.** On save, sync and "Test connection", `apps.service.ts` explains *why* a URL is refused: not `https` (I-3); host does not resolve; resolves to loopback/link-local ("never allowed"); resolves to an address outside `SSRF_ALLOWED_CIDRS` and the host is not in `SSRF_ALLOWED_HOSTS` ("ask the platform team to add `<host>` / `<ip>` to the SSRF allow-list"). `checkUrlSafety` stays the authoritative check. The allow-list is deployment config, never editable in the UI (04 E-1). | D-E2 | §4.2, §4.10, §8 Phase 1, §9 |
| **I-3** | **HTTPS required; internal apps with a private CA are trusted through `NODE_EXTRA_CA_CERTS`.** `safeFetch` allows `http:` (`ssrf-guard.ts:27`), so the fork rejects non-`https` base URLs itself. `safeFetch` uses Node's `https.request` with no custom `ca`, `agent` or `rejectUnauthorized` (`ssrf-guard.ts:18,272,283-295`), so the company root CA is added process-wide via `NODE_EXTRA_CA_CERTS` in the deployment; no per-app "skip TLS verification" option exists. 🟡 A-Q12. | D-E1 | §4.2, §4.3, §5.1, §10 |
| **I-4** | **Identity: the SSO subject is the primary verified identifier, plus an optional employee id.** Every requester signed in through the company IdP, so the execute body adds `sso_subject` (the user's `account.account_id` for the enabled IdP's `account.provider_id`, `schema/auth.ts:288-293`) and `employee_id` (a user attribute populated from an IdP claim via `identity_provider.claim_mapping.attributes`, `schema/auth.ts:613-618`, applied at SSO sign-in by `applyClaimAttributesAfter`, `auth/hooks.ts:1543,1631`). Receiver resolution order: `sso_subject` → `employee_id` → `external_user_id` → verified `email`. 🟡 A-Q13. | D-E1, D-E4 | §4.3, §4.4, §4.6, §9 |
| **I-5** | **Eligibility simplified; the cold-email / OTP / magic-link path is gone.** Magic link and email OTP are off (SSO-only, D-E3). A lead with only `contactEmail` (inbound mail from an employee who has never signed in) is still not a target; it becomes one after the employee's first SSO sign-in, when JIT provisioning creates the user and 30's claim re-points the ticket. A-Q11 closed as moot. Anonymous principals do not act (anonymous off, D-E3). | D-E3, D-E4 | §4.4, §4.10, §9, §10 |
| **I-6** | **No internet assumptions.** Connected apps are internal; the contract, stub receiver and implementer guide describe intranet HTTPS endpoints only. No component of this plan makes an internet call (`02-…` §11a). | D-E2 | Goal, §4.2, §4.3 |
| **I-7** | **Seams:** none removed (A-2, A-4, A-5 are UI/assistant seams unaffected by the environment); **F-12** added as a shared prerequisite (not counted here). | — | §7 |

## 1. Changes from v1

| v1 issue (review §3.5 + brief)                                                                                                                                            | v2 resolution                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Account" undefined; native `unblock()` treated as unlock (it is an anti-spam gate).                                                                                     | D-A1: accounts are **external**. The only backend is the connected app's HTTP API (D-A9). No native account operations.                                                                                                                        |
| Native 2FA reset / force sign-out proposed as backends; both accept any target incl. the owner (`functions/admin-reset-two-factor.ts:29-32`, `functions/admin.ts:289-299`). | **Out of scope.** Tracked as an independent upstream hardening PR (D-A14, §3).                                                                                                                                                                  |
| Three-part keys `support.account.*` break `scopeForPermission` (reads `split('.')[1]`).                                                                                  | Two-part generic keys `account.request`, `account.execute` (category `support`, D-R2, D-A6).                                                                                                                                                   |
| New keys silently auto-granted to Manager (`rbac-catalogue.ts:649`).                                                                                                      | D-A4: both keys in the fork block of `WORKSPACE_ADMIN_PERMISSIONS` (`rbac-catalogue.ts:613`) via F-7.                                                                                                                                          |
| Reuse `runWithPipeline` — private (`assistant.tools.ts`) and Quinn-shaped.                                                                                                | **Not reused.** Fork domain `lib/server/fork/account-actions/` owns its request/approve/execute state machine. Reused: 10's `canInTeam`, `assertTicketVisible`, `safeFetch`, the webhook HMAC scheme, `encrypt/decrypt`, `escalateTicket` (30).                                 |
| Audit rows under Quinn's principal; approved actions attributed to Quinn.                                                                                                | Requester **and** approver principals are columns on the fork row and actors on the audit rows. No Quinn in the v1 path.                                                                                                                       |
| Extend `assistant_pending_actions` / `originRole` enum.                                                                                                                   | Not touched (would be an upstream schema edit). Fork table `fork_account_action_requests` with its own status enum.                                                                                                                             |
| Pending actions need exactly one parent → People-profile actions impossible.                                                                                             | Moot: D-A12 makes actions **ticket-only**; `ticket_id` is required at insert.                                                                                                                                                                  |
| Proposals posted as Quinn and counted in copilot analytics.                                                                                                               | Own panel/approval card (`components/fork/account-actions/`); nothing written to `assistant_pending_actions` / `assistant_tool_calls`. Ticket notes written as the human.                                                                     |
| Idempotency key tied to `latestCustomerMessageId`; tool-call key unique forever.                                                                                          | Client-generated `client_request_id` (unique); execution claimed by a conditional status UPDATE; outbound `Idempotency-Key: <request id>`.                                                                                                      |
| `AuditEventType` closed union (`audit/log.ts:44`); `recordAuditEvent` swallows failures.                                                                                  | One fenced union block (shared F-9). State transitions use `recordAuditEventInTransaction` (`audit/log.ts:260`) in the same tx as the row update.                                                                                                     |
| Webhook backend is fire-and-forget; integrations registry needs per-app code.                                                                                            | A **synchronous**, contract-defined HTTP API per app (§4.3) — same signing scheme as outgoing webhooks, request/response semantics, no per-app code.                                                                                            |
| Approval routing unspecified.                                                                                                                                             | D-A11: the request escalates the ticket (30's `escalateTicket`, `source: 'account_action'`); approvers learn via native `ticket_assigned`.                                                                                                     |
| Remote schema may change between request and approval.                                                                                                                    | Request binds an identity + configuration snapshot (`binding_hash`, §4.6); approval and execution re-check it, and any material change returns the request to review.                                                                          |
| Quinn may invoke actions (open).                                                                                                                                          | D-A7: per-workspace opt-in, off by default, **later phase** (§4.9). v1 humans only.                                                                                                                                                           |

## 2. Requirements

| #   | Requirement                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Admins register **connected apps** — internal `https` services whose host is on the F-12 allow-list (D-E1, D-E2) — (base URL + signing secret) and **sync** the actions each app advertises; they may add actions manually, enable/disable them and override `min_tier` (D-A6, D-A9). |
| R2  | An agent **runs** an action directly iff they can see the ticket and hold `account.execute` via `canInTeam` on a tier team with tier ≥ `min_tier` (D-A8).                                     |
| R3  | Otherwise, an agent holding `account.request` files a **request**; the ticket escalates to the lowest tier ≥ `min_tier` (D-A11); an eligible approver approves → the action executes.        |
| R4  | Approver: holds `account.execute` **team-scoped** on the ticket's current owning team (`canInTeam`, D-A3), whose tier ≥ `min_tier`; can see the ticket; **requester ≠ approver** (D-A2); Owner/Admin break-glass (D-A10). |
| R5  | Actions only from a **ticket** (D-A12). The customer is the ticket requester — an SSO-authenticated employee (D-E4); the app resolves its own account from the identity we send, primarily the SSO subject (D-A5, §4.4). |
| R6  | Requests expire after **72 h**; the requester is notified (D-A13).                                                                                                                             |
| R7  | Every request / decision / execution / expiry audited with the human actor(s); full history in the fork table (no retention prune).                                                           |
| R8  | Idempotent under double-click, retry, crash and concurrent approvals; ambiguous external outcomes surface as **unknown**, are reconciled under the original idempotency key, and never re-executed under a new key until resolved. |
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
  client.ts              signed calls to the app API (advertise, execute, status lookup)
  authorize.ts           execTeams / canRunDirect / canRequest / canDecide via canInTeam + ticket visibility (D-A2/3/8/10)
  identity.ts            eligibility + customer identity + binding snapshot/hash (§4.4, §4.6)
  state-machine.ts       request / approve / reject / cancel / execute / reconcile / resolve / expire (tx + audit)
  routing.ts             resumable routing + escalateTicket call + re-route (§4.7)
  expiry-sweep-queue.ts  job handler: expire + notify (one tx), resume routing, settle + reconcile (§4.8)
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
  string. Rotation = generate new, show once, overwrite.
- **Base URL validation (I-1…I-3).** On save, sync and "Test connection", `apps.service.ts` runs, in order:
  1. Parse; scheme must be `https:` (upstream also allows `http:`, `ssrf-guard.ts:27`) → "Connected apps must use HTTPS".
  2. Resolve the host (system DNS, as upstream `checkUrlSafety` does) → "Host `<host>` does not resolve on the intranet".
  3. Any resolved address in loopback (127/8, ::1) or link-local (169.254/16, fe80::/10) → "Loopback and link-local
     addresses are never allowed" (F-12 keeps these blocked even when allow-listed).
  4. Host not in `SSRF_ALLOWED_HOSTS` and a resolved address outside `SSRF_ALLOWED_CIDRS` → "`<host>` (`<ip>`) is not on
     the server's SSRF allow-list; ask the platform team to add it to `SSRF_ALLOWED_HOSTS` or `SSRF_ALLOWED_CIDRS`".
  5. `checkUrlSafety` (`content/ssrf-guard.ts:165`, with F-12) is the authoritative check; if it still refuses, the
     generic "Address not allowed" error is shown.
  Steps 1–4 only produce the message; they never widen what `checkUrlSafety` allows. The allow-list is read from
  deployment config (F-12) and shown read-only on the settings page. A TLS failure on "Test connection" reports
  "certificate not trusted — is the company CA in `NODE_EXTRA_CA_CERTS`?" (I-3).
- **Action definitions** (`fork_account_action_definitions`): one row per `(app, action_key)`, `source = 'advertised' |
  'manual'`.
  - **Sync** (admin button, and on app save): `GET {base}/quackback/actions` → validate with the contract zod → upsert:
    new keys inserted **disabled** with `min_tier = clamp(suggested_min_tier, 1, 3)` (X-2); existing advertised rows get label,
    description, `input_schema`, `suggested_min_tier`, `risk` refreshed, **admin's `enabled` / `min_tier` kept**; keys no
    longer advertised get `missing_since` set and are disabled. Manual rows are never touched by sync.
  - **Manual**: admin enters key, label, description, `input_schema` (form builder over the §4.3 subset, or JSON) and
    `min_tier` — for apps that implement execute but not advertise.
  - Admin edits (`enabled`, `min_tier`) and syncs are audited (`account_action.config_changed`). Every change to a
    definition's `input_schema`, `enabled`, `valid` or `min_tier` bumps its `config_version`; every change to an app's
    `base_url`, `enabled` or attribute allow-list bumps the app's `config_version`, and a secret rotation bumps
    `secret_version`. These feed the approval binding (§4.6).
- Adding an action = the app advertises it (or an admin adds it) and an admin enables it. **No code, key or migration.**

### 4.3 The Quackback Account Actions API (contract v1, implemented by each connected app)

Transport: HTTPS to an intranet host via `safeFetch` (`content/ssrf-guard.ts:266`: IP-pinned, never follows redirects,
capped body; intranet addresses pass only through the F-12 allow-list) with `timeoutMs: 10000`, `maxResponseBytes: 65536`
(advertise) / `16384` (execute), `onOverflow: 'error'`. TLS is verified against Node's trust store; internal apps signed
by the company CA are trusted by adding that CA via `NODE_EXTRA_CA_CERTS` in the deployment (🟡 A-Q12). There is no
"skip verification" option.

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
      "suggested_min_tier": 1,             // integer, clamped to 1..3 (X-2)
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
`Idempotency-Key: <request id>`). The body is the request's **bound snapshot** (§4.6), not a fresh read:

```jsonc
{
  "id": "<request uuid>", "action": "unlock_account", "definition_version": 7, "requested_at": "…",
  "customer": {                           // §4.4 — server-derived; the requester is an SSO employee (D-E4)
    "quackback_principal_id": "principal_…", "name": "…",
    "sso_subject": "…|null", "sso_provider": "<registration id>|null",   // primary identifier (I-4)
    "employee_id": "…|null",              // from the IdP-claim-mapped attribute, if configured (I-4)
    "email": "…|null", "email_verified": true,
    "external_user_id": "…|null", "external_user_id_source": "verified_widget_jwt" | "rest_identify" | null,
    "attributes": { /* allow-listed only */ }
  },
  "inputs": { "reason": "…" },
  "actor": {
    "requested_by": { "principal_id": "…", "email": "…", "name": "…" },
    "approved_by": { "principal_id": "…", "email": "…", "name": "…" } | null,   // null iff mode = "direct"
    "mode": "direct" | "approved", "break_glass": false
  },
  "ticket": { "id": "ticket_…" }
}
```

**Receiver obligations (contract v1, A3/A4):**

- **Idempotency:** reserve the `Idempotency-Key` atomically **before** any side effect; keep the record and the final
  response for **≥ 30 days**; a repeat with the same key returns `409` with the original response body (or
  `{"status":"in_progress"}` while the first is still running) and never executes twice.
- **Rejections before execution:** the receiver may answer `4xx` with `{"status":"rejected","code":C,"message"?}` only when
  nothing was executed, where `C ∈ { invalid_signature, stale_timestamp, unknown_action, invalid_inputs,
  unsupported_contract, action_disabled }`. Any other `4xx` shape is treated as ambiguous.
- **Verified identity:** resolve the account from the first present identifier in this order: `sso_subject` (the
  company IdP's `sub`, which internal apps signing in through the same IdP already store), `employee_id`,
  `external_user_id`, then `email` only when `email_verified` is true; never resolve on an unverified identifier (answer
  `customer_not_found`). If two present identifiers resolve to different accounts, answer `customer_ambiguous`.
  `quackback_principal_id`, `sso_provider` and `name` are informational.
- **Status lookup (mandatory):** `GET {base}/quackback/actions/requests/{idempotencyKey}` (`X-Quackback-Event:
  account_action.status`, signed like advertise) → `200` with the stored final response, `200 {"status":"in_progress"}`,
  or `404 {"status":"not_received"}`. `not_received` is only valid if the key was never reserved; because stale
  timestamps (> 5 min) are rejected, a key not received 5 minutes after our last send can never be executed later.

Response → outcome mapping (anything not listed is `unknown`):

| Response                                                                                          | Settles as                                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `200 {"status":"succeeded","message"?,"result"?}` (valid per contract zod)                        | `succeeded`                                   |
| `200 {"status":"failed","message"?}`                                                              | `failed` / `APP_FAILED`                       |
| `200 {"status":"customer_not_found" \| "customer_ambiguous","message"?}`                          | `failed` / `CUSTOMER_NOT_RESOLVED`            |
| `4xx {"status":"rejected","code":C}` with `C` in the list above                                   | `failed` / `REJECTED_<C>` (no side effect)    |
| Local failure before any byte was sent: `SsrfError` (raised before connecting, `ssrf-guard.ts:267-268` — e.g. the host was removed from the F-12 allow-list or now resolves elsewhere) or socket `ECONNREFUSED` | `failed` / `NOT_SENT`             |
| `409` with a valid original body                                                                  | the original body's outcome (per this table)  |
| `409 {"status":"in_progress"}`, malformed `409`, malformed or unexpected `2xx`, any other `4xx`, `5xx`, timeout, reset, `ResponseTooLargeError` | `unknown` (reconciled, §4.6; never auto-re-executed) |

`message`/`result` are untrusted: stored as capped plain-text `result_summary` (≤ 2 KB, `result` JSON-stringified) and
rendered as text only. The fork ships the contract as zod schemas plus a stub receiver (including the idempotency store
and status lookup) used in tests; a short implementer guide for internal app teams (endpoints, signing, idempotency,
identity resolution order, "serve HTTPS with a company-CA certificate and ask the platform team for an allow-list entry")
lives in `plans/` (never `docs/`).

### 4.4 Customer identity (D-A5, D-E4) and eligibility

Every requester is an employee who signs in with the company IdP (D-E1, D-E4), so the identity sent is anchored on the
SSO account rather than on email proofs. The customer is the anchor ticket's `requester_principal_id` (`packages/db/src/schema/tickets.ts:110`). Identity is
**always server-derived** from that principal and the app's configuration; the caller supplies only `ticketId`,
`definitionId`, `inputs`, `clientRequestId` and the binding hash it was shown (§4.6). Input schemas may not declare
identity-bearing properties (`email`, `user_id`, `external_user_id`, `account_id`, `principal_id`, `sso_subject`, `employee_id`, `customer*`; rejected at
sync/save with the §4.3 subset rules), and the contract requires receivers to resolve the target account **only** from
`customer`, never from `inputs`.

**Eligibility** (else the panel explains why and offers no Run/Request):

1. The ticket has a requester that is not a team member or service principal (`isTeamMember`, `lib/shared/roles.ts:53` —
   prevents acting on another agent or oneself; every requester is an employee, but agents are not targets).
2. The requester principal has a **user** row (`principal.user_id`, `schema/auth.ts:818`) — true for every employee who
   has signed in once via SSO (JIT provisioning, `04-…` §3). The only remaining non-user requester is a lead that carries
   only `contactEmail`, created by inbound mail (IMAP) from an employee who has never signed in
   (`conversation.email-cold-inbound.ts:74-135`); it is **not eligible** because the sender address is not proven. The
   panel says "The requester hasn't signed in with SSO yet — ask them to open the help hub once". Their first SSO sign-in
   provisions the user and 30's claim re-points the ticket to the user principal, after which the action is available.
   Any pending request on the old principal is re-pointed by F-5 and, because the bound identity changed, returns to
   review (§4.6). (Magic link / email OTP are off, D-E3; anonymous principals cannot act.)
3. At least one **verified identifier** exists (below) — normally `sso_subject`.

Payload `customer` fields (captured into the request's binding snapshot, §4.6 — not re-read silently at execution):

- `sso_subject` + `sso_provider` — **primary identifier (I-4).** The user's `account` row (`schema/auth.ts:288-293`)
  whose `provider_id` equals the `registration_id` of an **enabled** `identity_provider` (`schema/auth.ts:682-741`);
  `sso_subject = account.account_id` (the IdP `sub`, or the claim configured in `claim_mapping.profile.claims.id`,
  `:603-610`), `sso_provider = registration_id` (informational). Sent as `null` when the user has no such account, has
  accounts at more than one enabled IdP, or when another user holds the same `(provider_id, account_id)` pair (the
  index is deliberately non-unique, `schema/auth.ts:316-321`) — in those cases the lower identifiers are used.
  IdP-asserted, so verified.
- `employee_id` — the value of the user attribute named by `fork_settings.account_actions.employeeIdAttributeKey`
  (default unset → `null`), read from `user.metadata` via `parseUserAttributes` (`user.attributes.ts:43`). The intended
  source is an IdP claim copied at every SSO sign-in by `identity_provider.claim_mapping.attributes`
  (`schema/auth.ts:613-618`, applied by `applyClaimAttributesAfter`, `auth/hooks.ts:1543,1631`; admins should set
  `overrideExisting` and `syncOnSignIn` so the IdP value wins). Every other writer of user attributes (API-key REST
  identify, verified widget identify, admins) is also trusted, so the value counts as verified (🟡 A-Q13).
- `email` + `email_verified` — `user.email` when `user.emailVerified` (`schema/auth.ts:146`) and `realEmail(user.email)`
  is non-null (`lib/shared/anonymous-email.ts:17`, which filters minted SSO placeholders); else the user principal's own
  `contactEmail`, which the user supplied and confirmed by mail before it was written (`schema/auth.ts:845-855`); both
  cases send `email_verified: true`. Otherwise `email: null`. An unverified address is never sent.
- `external_user_id` + `external_user_id_source` — `user.external_id` (`schema/auth.ts:176`, unique `:197-198`), set only
  by the **verified widget identify** path from the JWT `sub` (`routes/api/widget/identify.ts:247`) → `verified_widget_jwt`;
  else `metadata._externalUserId`, written by the API-key-authenticated REST identify path (`domains/users/user.identify.ts:73-80`,
  key `EXTERNAL_ID_KEY` `user.attributes.ts:32`, reader `extractExternalId` `:58`) → `rest_identify`; else `null`. Both
  sources are server-asserted and count as verified.
- `name`, `quackback_principal_id` — informational; receivers must not resolve on them.
- `attributes` — `user.metadata` custom attributes (merged at identify time: widget `identify.ts:229-234,301`, REST
  `user.identify.ts:73-81`; parsed by `parseUserAttributes` `user.attributes.ts:43`), **filtered to the app's
  `identity_attribute_keys` allow-list** (default empty) so one app never receives attributes meant for another.

The app resolves its own account (verified identifiers only, §4.3) and answers `customer_not_found` /
`customer_ambiguous` when it cannot.

### 4.5 Authorization (D-A2, D-A3, D-A8, D-A10, D-A4)

Team-aware from the first runnable phase. `account.request` / `account.execute` are `TEAM_SCOPABLE_PERMISSIONS` and are
checked **only** through 10's `canInTeam(actor, key, teamId)`; fork code never calls `can()` with them (10's lint test).
A workspace-wide custom-role grant of either key is inert; Owner/Admin qualify through `canInTeam`'s system-role grant;
Managers hold neither (D-A4). Tier data comes from 30: `listTierMemberships(principalId) → [{ teamId, tier }]` and
`getTeamTier(teamId)`; tiers are 1..3 in v1 (X-2).

Definitions:

- `currentTeam(ticket)` — 30 §4.1: `tickets.assignee_team_id`, else the paired conversation's `assigned_team_id`; read
  live on every check.
- `execTeams(actor, minTier)` — memberships `{teamId, tier}` with `tier ≥ minTier` **and**
  `canInTeam(actor, 'account.execute', teamId)`.

Every operation first loads the ticket through `assertTicketVisible(ticketId, actor)` (`ticket.service.ts:115`; fused
existence + `ticketFilter`, so an invisible ticket is `404`). For operations addressed by request id (approve, reject,
cancel, resolve, re-send, check now), the request's `ticket_id` is loaded and asserted the same way; a request whose ticket
was hard-deleted (`ticket_id` NULL) is actionable only by Owner/Admin.

- **Run directly** iff `execTeams(actor, def.min_tier)` is non-empty → `execution_mode='direct'`, `break_glass=false`.
  Otherwise an **Owner/Admin** may run directly as `break_glass=true`, audited (🟡 A-Q3). Direct runs have no approver.
- **Request** iff the actor cannot run directly and holds `canInTeam(actor, 'account.request', T)` for a membership `T`
  with `tier(T) ≥ tier(currentTeam)` (roll-up; any tier membership if the ticket is untiered/intake) — the from-team
  authorization 30 §11 delegates to this plan.
- **Approve / reject** (`canDecide(actor, request)`), evaluated against the ticket's **current** owning team `C`, not the
  team stored at routing (🟡 A-Q9):
  1. `actor ≠ requested_by` — always, including Owner/Admin (D-A2, D-A10); also a DB check (§5.3).
  2. `tier(C) ≥ max(request.min_tier_at_request, def.min_tier)` (re-checked because an admin may have raised `min_tier`).
     If `C` no longer qualifies (the ticket was moved or de-escalated), the request is flagged for **re-routing** (§4.7)
     and is not approvable by the normal path until it qualifies again.
  3. **D-A3:** `actor ∈ team_members(C)` **and** `canInTeam(actor, 'account.execute', C)`.
  4. Else **Owner/Admin break-glass** (D-A10): allowed (still not self), `break_glass=true`, audit
     `metadata.breakGlass=true`.
- **Cancel:** the requester only, while `pending_approval`, and only while they can still see the ticket (they watch it
  after escalation, 30 T-1); otherwise an eligible decider rejects it.
- **Resolve / re-send / check now on `unknown`:** `execTeams(actor, def.min_tier)` non-empty or Owner/Admin; for
  `execution_mode='approved'` rows, not the requester.

### 4.6 State machine

```
            request (§4.5)                                  approve (§4.5, binding hash matches)
 [none] ──────────────────────▶ pending_approval ──────────────────────────────▶ executing ──▶ succeeded
   │                             │  │  │  └─ binding changed ─▶ (re-bound, stays pending; re-review)  ├──▶ failed
   │ run (§4.5)                  │  │  └─ reject ─▶ rejected                                          └──▶ unknown ─▶ (reconcile / resolve)
   └─────────────────────────────┼──┼─────────────────────────────────────────────▶ executing              succeeded | failed
                                 │  └─ cancel (requester) ─▶ cancelled
                                 └─ expires_at ≤ now (sweep only) ─▶ expired (+ notification, same tx)
```

**Row shapes** (enforced by §5.3 checks):

| Case | `execution_mode` | `decision` | `decided_by_principal_id` | `break_glass` | `expires_at` |
| --- | --- | --- | --- | --- | --- |
| Direct run, tier-qualified | `direct` | NULL | NULL | false | NULL |
| Direct run, Owner/Admin out of tier | `direct` | NULL | NULL | true | NULL |
| Pending request | `approved` | NULL | NULL | false | set |
| Approved (team member) | `approved` | `approved` | ≠ `requested_by` | false | set |
| Approved (Owner/Admin break-glass) | `approved` | `approved` | ≠ `requested_by` | true | set |
| Rejected | `approved` | `rejected` | ≠ `requested_by` | false/true | set |
| Cancelled / expired | `approved` | NULL | NULL | false | set |

**Binding snapshot (A4).** At request (and direct-run) time the server builds `binding_snapshot` (jsonb) = the exact
execute body of §4.3 minus `actor.approved_by`, plus the app's `base_url`, `config_version`, `secret_version` and the
definition's `config_version` / `input_schema_hash` / `min_tier`. `binding_hash` = sha256 over the canonical JSON of the
**material** fields (🟡 A-Q10 default): every `customer` identifier (`quackback_principal_id`, `sso_subject`,
`employee_id`, `email`, `email_verified`, `external_user_id` + source, `attributes`), `inputs`, app `base_url` / `config_version` / `secret_version`, definition
`config_version`. `name` fields and the requester's own contact details are informational only. The approval card and the
run dialog show the snapshot and send back the hash they displayed.

- **Run:** recompute the binding; if it differs from the hash the dialog showed → `409 BINDING_CHANGED` (dialog refreshes).
  Else insert `status='executing'` with the snapshot (row shape above) in one tx with the `account_action.requested` audit
  (`metadata.mode='direct'`), then execute.
- **Request:** one tx — insert `pending_approval`, `expires_at = requested_at + 72 h` (constant `REQUEST_TTL_HOURS`, D-A13),
  snapshot + hash, `routing_state='pending'`, `routed_from_team_id = currentTeam`, + `account_action.requested` audit. Then
  route (§4.7). A replayed submit (same `client_request_id`) returns the row **and resumes routing** if
  `routing_state='pending'`.
- **Approve:** one tx — lock the row (`SELECT … FOR UPDATE`); re-run §4.5 against live state; recompute the binding from
  live sources. App or definition disabled/missing → `failed` / `CONFIG_CHANGED` (no call). Live hash ≠ stored hash →
  re-parse `inputs` with the current schema (failure → `failed` / `INPUT_CONTRACT_CHANGED`), otherwise **re-bind**
  (store the new snapshot/hash, `rebound_at`, audit `account_action.rebound` with a field-level diff) and return
  `409 BINDING_CHANGED`: the card shows what changed and the approver must approve the new hash. Otherwise
  `UPDATE … SET status='executing', decision='approved', decided_by_principal_id=…, break_glass=…, decided_at=now(),
  execution_started_at=now() WHERE id=? AND status='pending_approval' AND expires_at > now() AND binding_hash = :shownHash`;
  zero rows ⇒ 409. Approve and reject add a ticket note **as the decider** — the requester watches after escalation (D-T2),
  so native `ticket_note_added` notifies them (`events/targets.ts:994-1020`: agent watchers, actor excluded).
- **Execute** (both paths): tx1 = state → `executing` + `recordAuditEventInTransaction` (`account_action.requested` /
  `.approved`); immediately before sending, re-read the app row and compare `base_url` / `config_version` /
  `secret_version` with the snapshot (a change in that window settles `failed` / `NOT_SENT` + `CONFIG_CHANGED`); send the
  **snapshot** body; tx2 = settle per §4.3 + `account_action.executed` audit. `last_sent_at` is written before the call.
- **Stuck `executing`** (process died): the sweep settles `execution_started_at < now() − 5 min` to `unknown`.
- **`unknown` reconciliation (A3):** the sweep calls the status lookup with the **original** request id once
  `last_sent_at < now() − 6 min` (the receiver's 5-minute timestamp window plus skew), backing off (6 min, 30 min, 2 h,
  12 h, then daily; `reconcile_attempts`, `next_reconcile_at`). A stored final response settles per §4.3; `not_received`
  settles `failed` / `NOT_RECEIVED` (guaranteed never executed); `in_progress` or a lookup error leaves it `unknown`.
  Audit `account_action.reconciled`. An eligible resolver (§4.5) may also **Check now**, **Re-send** (same request id and
  `Idempotency-Key`; refused if the live binding no longer matches the snapshot) or **Mark resolved** (succeeded/failed,
  attested note, audit `account_action.resolved`).
- **Retry:** a new request with `retry_of_request_id` is allowed from `failed`, `expired`, `rejected` or `cancelled`, and
  **refused while the original is `executing` or `unknown`** — a fresh idempotency key is issued only after the original's
  outcome is known or a human has attested it. Rows are never re-executed under a new key.
- **Idempotency:** `client_request_id` (uuid, created when the dialog opens) is unique. Outbound `Idempotency-Key` = row `id`.

### 4.7 Routing (D-A11, D-A3, integration with 30) — resumable

Routing is a durable sub-state of a `pending_approval` row: `routing_state ∈ { pending, routed, not_needed, failed }`,
`routing_attempt`, `routing_last_error`, `routed_at`, `routed_from_team_id`, `requested_target_team_id` (when the requester
picked among several teams), `escalation_id`, `approver_team_id` (the team routed to; informational — authorization always
uses the current team, §4.5). `routeRequest(id)` is idempotent and is run after the insert, on a replayed submit, when the
panel/queue loads the row, and by the sweep for `routing_state='pending'` rows idle for > 1 min:

1. Load the row and ticket; `C = currentTeam(ticket)`. If `tier(C) ≥ min_tier` → `routing_state='not_needed'`,
   `approver_team_id = C`.
2. Otherwise call 30's `escalateTicket({ subject: { ticketId }, toTeamId: requested_target_team_id, targetTier: min_tier,
   reason: 'access_required', note: "Account action request: {label} ({id})", expectedFromTeamId: routed_from_team_id,
   source: 'account_action', idempotencyKey: 'account_action:{id}:{routing_attempt}' }, requesterActor)`. 30 performs no
   permission check (30 §11); 40 authorized with `account.request` (§4.5). The ticket note travels with the escalation,
   under 30's idempotency. Effects (30): ticket and paired conversation move, the requester is cleared and watches (D-T2),
   SLA carries (D-T1), the distributed agent gets native `ticket_assigned`.
3. One tx: `routing_state='routed'`, `escalation_id`, `approver_team_id`, `routed_at`.
4. `CONFLICT` (the ticket moved since `routed_from_team_id`) → set `routed_from_team_id = C`, `routing_attempt + 1`, and
   retry from step 1. Other errors → stay `pending` with `routing_last_error`; after 5 attempts → `routing_state='failed'`
   (queue and panel flag it; approval by an eligible member of the current team and Owner/Admin break-glass still work).

In the `not_needed` case the requester's ticket note is written after step 1 with a `request_note_message_id` marker; the
sweep writes it if the marker is missing (at-least-once: a crash between note and marker can duplicate the note, never lose
it).

**Ticket moves after routing (🟡 A-Q9).** Approval follows the ticket's current team. When the sweep or a read sees
`tier(currentTeam) < min_tier` on a routed request, it sets `routing_state='pending'`, `routed_from_team_id = C`,
`routing_attempt + 1` (audit `account_action.rerouted`), and routing re-escalates. A request whose ticket moved to another
qualifying team needs no re-route: that team's members become the eligible approvers.

Conversations: the panel works on a ticket, or a conversation paired with a ticket (`getLinkedCustomerTicket`,
`inbox/inbox.query.ts:647`). A ticket-less conversation shows "Convert to a ticket to use account actions" (native
convert) — D-A12.

### 4.8 Sweep, expiry and notification (D-A13)

A fork job `fork-account-actions-sweep` (cron `*/5 * * * *`, `maxAttempts: 3`, with a `cronEnabled` gate that is true only
when a `pending_approval` or `executing` row, or an `unknown` row with `next_reconcile_at ≤ now()`, exists — same pattern as
`sla-breach-sweep`, `jobs/definitions.ts:203-215`) registered via shared seam **F-8**. Each step is idempotent:

- **Expire + notify, one tx per row:** `UPDATE … SET status='expired' WHERE id=? AND status='pending_approval' AND
  expires_at <= now() RETURNING *`; in the same tx `account_action.expired` audit (actor type `system`, `audit/log.ts:164`)
  and `createNotification(input, tx)` (`domains/notifications/notification.service.ts:74-77`, accepts a `tx`) to the
  requester, with the **existing** type `ticket_note_added` (title "Account action request expired: {label}", metadata
  `{ ticketId, audience: 'admin', accountActionRequestId, dedupKey: 'account_action_expired:{id}' }`); the returned id is
  stored in `expiry_notification_id`. The notification commits iff the transition commits, and the conditional transition
  happens once, so it is neither lost nor duplicated. Only this function writes `expired`; reads display
  `expires_at ≤ now()` as expired without writing. A new `NotificationType` is avoided (closed union
  `notification.types.ts:12`, 4 seams; 🟡 A-Q1). No ticket note (a note needs an agent principal,
  `ticket-message.service.ts:481-486`).
- **Resume routing** (`routing_state='pending'`, §4.7), **re-route** on ticket moves, and write missing request notes.
- **Settle stuck `executing`** rows to `unknown`, then **reconcile** due `unknown` rows (§4.6).
- The ticket stays on the approver tier after expiry/rejection; de-escalation is 30's normal flow.

### 4.9 Quinn access (D-A7) — deferred phase; v1 does not deliver it

v1 exposes no assistant tool, so AI-initiated requests are **not** part of the v1 capability set. Later, gated by `fork_settings.account_actions.quinnEnabled` (default **false**, per
workspace):

- **Seam A-5 (deferred):** spread fork specs into the `extraSpecs` argument of `assembleAssistantToolset` at
  `domains/assistant/assistant.runtime.ts:1085-1088` (`[...workspaceMcpSpecs, ...connectorSpecs, ...forkSpecs]`). Extra
  specs always ride the execution pipeline (`assistant.tools.ts:416-423`) and `resolveEffectiveToolMode`
  (`assistant.tools.ts:90-96`) honours `approvalPolicy: 'approval'` → propose.
- Quinn has no tier, so every Quinn invocation is a **request** (never a direct run) and a human approver completes it
  under §4.5. Open design point for that phase: approved pending actions are attributed to Quinn upstream, so the fork
  spec's `execute` must hand off to this plan's state machine with Quinn recorded as requester and the human as
  approver, rather than execute inside the Quinn pipeline. The §4.5 team checks, the binding snapshot and the §5.3 row
  shapes apply unchanged.

### 4.10 UI

- **Account actions panel** (`account-actions-panel.tsx`) via `<ForkAccountActionsSlot item />` in the inbox detail
  panel after `<CompanyCard>` (`inbox-detail-panel.tsx:467`; co-located with 30's `ForkTierPanel` slot, T-2). Lists enabled
  apps and their enabled actions with a tier badge; per action **Run**, **Request…** (with target tier shown), or disabled
  with the reason ("needs Tier 2", "requester hasn't signed in with SSO yet"). Renders nothing when the feature
  is off or the viewer has no team-scoped `account.*` grant (`canInTeam`) and is not Owner/Admin.
- **Action dialog**: form generated from `input_schema` (§4.3 subset); shows the identity that will be sent (SSO
  subject, employee id, email, with verified flags) and submits the binding hash it displayed.
- **Approval card**: requester, bound customer identity, app + base URL, action, inputs, age/expiry, routing state,
  "changed since request" diff after a re-bind; Approve (sends the displayed hash) / Reject (reason). `unknown` rows show
  reconciliation status with Check now / Re-send / Mark resolved. Shown in the panel for the ticket's requests and on
  `/admin/fork-account-requests` (filters: "I can approve", "I requested", "Unknown outcome"); the queue lists only rows
  whose ticket passes `ticketFilter(actor)`.
- **Settings page** `/admin/settings/fork-account-actions` (registered via **F-4**, gated `integration.manage`): connected
  apps (URL with the §4.2 allow-list validation and its messages, secret generate/rotate, attribute allow-list, enable),
  a read-only view of the effective `SSRF_ALLOWED_HOSTS` / `SSRF_ALLOWED_CIDRS`, the workspace-level employee-id attribute
  key, **Sync** + last result, action table (enable,
  `min_tier`, source, risk, missing/invalid badges), manual action editor, "Test connection" (= signed advertise call).

## 5. Data model (fork lineage, `packages/db/drizzle-fork/`)

### 5.1 `fork_connected_apps`

| Column                                            | Type                                   | Notes                                                    |
| ------------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| `id`                                              | uuid PK                                |                                                          |
| `name`                                            | text NOT NULL                          |                                                          |
| `base_url`                                        | text NOT NULL                          | `https` only; intranet host on the F-12 allow-list; checked on save, sync and every call (§4.2) |
| `secret_ciphertext`                               | text NOT NULL                          | `encrypt(…, 'fork-connected-app-secrets')`; never returned |
| `enabled`                                         | boolean NOT NULL default false         |                                                          |
| `identity_attribute_keys`                         | text[] NOT NULL default `'{}'`         | allow-list for `customer.attributes`                     |
| `last_sync_at`, `last_sync_status`, `last_sync_error` | timestamptz / text / text          | `ok` \| `error` \| `never`                               |
| `config_version`, `secret_version`                | integer NOT NULL default 1             | bumped on `base_url`/`enabled`/allow-list change and on secret rotation (§4.2); bound at request (§4.6) |
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
| `min_tier`                          | smallint NOT NULL check `BETWEEN 1 AND 3` | admin-controlled; v1 = the three Tier templates (X-2)         |
| `suggested_min_tier`, `risk`        | smallint NULL / text NULL                 | as advertised                                                |
| `enabled`                           | boolean NOT NULL default false            |                                                              |
| `valid`                             | boolean NOT NULL default true             | false if the advertised schema is outside the subset          |
| `source`                            | text NOT NULL check `IN ('advertised','manual')` |                                                       |
| `missing_since`                     | timestamptz NULL                          | no longer advertised                                         |
| `config_version`                    | integer NOT NULL default 1                | bumped on any change to schema, `enabled`, `valid`, `min_tier` |
| `updated_by_principal_id`           | typeid principal NULL FK SET NULL         | staff                                                        |
| `updated_at`                        | timestamptz                               |                                                              |

Unique `(app_id, action_key)`. No endpoint-path column: the contract fixes `/quackback/actions/{key}` (§10 A-Q6).

### 5.3 `fork_account_action_requests`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | also the outbound `Idempotency-Key` and status-lookup key |
| `client_request_id` | uuid NOT NULL UNIQUE | |
| `app_id`, `definition_id` | uuid NOT NULL FK RESTRICT | |
| `action_key`, `action_label` | text NOT NULL | snapshots for history |
| `min_tier_at_request`, `input_schema_hash` | smallint check `BETWEEN 1 AND 3` / text NOT NULL | snapshots for §4.5/§4.6 |
| `ticket_id` | typeid ticket NULL FK SET NULL | required at insert (app check); nullable only so ticket hard-deletes aren't blocked |
| `customer_principal_id` | typeid principal NULL FK SET NULL | ticket requester at request time; **re-pointed on merge** (F-5) — a re-point changes the bound identity, so the next approve re-binds (§4.6) |
| `binding_snapshot`, `binding_hash` | jsonb NOT NULL / text NOT NULL | §4.6; the execute body is sent from the snapshot |
| `rebound_at` | timestamptz NULL | last re-bind |
| `inputs` | jsonb NOT NULL | validated inputs (no secrets, no identity fields) |
| `status` | text NOT NULL | check `IN ('pending_approval','rejected','cancelled','expired','executing','succeeded','failed','unknown')` |
| `execution_mode` | text NOT NULL | `direct` \| `approved` |
| `break_glass` | boolean NOT NULL default false | Owner/Admin out-of-tier run or off-team decision |
| `decision`, `decided_by_principal_id`, `decided_at` | text NULL / typeid principal NULL FK RESTRICT / timestamptz | `approved` \| `rejected`; staff |
| `requested_by_principal_id`, `requester_tier` | typeid principal NOT NULL FK RESTRICT / smallint NULL | staff |
| `routing_state`, `routing_attempt`, `routing_last_error`, `routed_at` | text NULL / smallint NOT NULL default 0 / text NULL / timestamptz NULL | §4.7; NULL for direct runs |
| `routed_from_team_id`, `requested_target_team_id`, `approver_team_id` | typeid team NULL (×3) | §4.7; `approver_team_id` informational |
| `escalation_id` | uuid NULL | → `fork_support_escalations.id` (30) |
| `request_note_message_id`, `expiry_notification_id` | text NULL | durable completion markers (§4.7, §4.8) |
| `decision_reason` | text NULL | reject reason / resolve attestation |
| `requested_at`, `expires_at`, `execution_started_at`, `last_sent_at`, `settled_at` | timestamptz | `expires_at` NULL for direct runs |
| `reconcile_attempts`, `next_reconcile_at` | smallint NOT NULL default 0 / timestamptz NULL | `unknown` reconciliation (§4.6) |
| `result_summary`, `error_code` | text NULL | capped, untrusted text |
| `retry_of_request_id` | uuid NULL self-FK | |

Checks (row shapes of §4.6, A2):

- `execution_mode <> 'direct' OR (decision IS NULL AND decided_by_principal_id IS NULL AND expires_at IS NULL AND
  routing_state IS NULL)` — a direct run never has an approver row shape.
- `(decision IS NULL) = (decided_by_principal_id IS NULL)`.
- `decided_by_principal_id IS NULL OR decided_by_principal_id <> requested_by_principal_id` (D-A2, D-A10 — two-person
  separation on every decided row, break-glass included).
- `execution_mode <> 'approved' OR status NOT IN ('executing','succeeded','failed','unknown') OR decision = 'approved'`
  (an approved-mode request executes only after an approval; `failed` from `CONFIG_CHANGED`/`INPUT_CONTRACT_CHANGED` at
  approval time carries the approving decision).
- `status <> 'rejected' OR decision = 'rejected'`.
- `status <> 'pending_approval' OR (expires_at IS NOT NULL AND ticket_id IS NOT NULL AND execution_mode = 'approved')`.

Indexes: partial `(expires_at) WHERE status='pending_approval'` (queue + sweep); partial `(execution_started_at) WHERE
status='executing'`; partial `(next_reconcile_at) WHERE status='unknown'`; partial `(requested_at) WHERE
routing_state='pending'`; `(ticket_id, requested_at DESC)`; `(requested_by_principal_id, requested_at DESC)`. No retention
prune (R7).

**Principal references (`02-…` §8):** `customer_principal_id` re-points on merge (fork step via F-5); staff columns
(`requested_by`, `decided_by`, `created_by`, `updated_by`) are declared exemptions. The snapshot's principal id is not
re-pointed (it is history); the mismatch forces re-review.

## 6. Permissions

### 6.1 Keys (fork block via F-7, category `support`)

| Key               | Meaning                                                                                  | Owner/Admin | Manager (D-A4)                          | Contributor | Seeded roles (10-rbac)          |
| ----------------- | ---------------------------------------------------------------------------------------- | ----------- | --------------------------------------- | ----------- | ------------------------------- |
| `account.request` | File a request for an action above the holder's tier; cancel own requests                | ✅          | ❌ (in `WORKSPACE_ADMIN_PERMISSIONS`)   | ❌          | Tier 1, Tier 2, Tier 3 Agent    |
| `account.execute` | Run actions with `min_tier ≤` holder's tier; approve requests at or below it; resolve `unknown` | ✅    | ❌                                      | ❌          | Tier 1, Tier 2, Tier 3 Agent    |

Tiering comes from team membership and `min_tier`, not from which key a role holds — the same two keys serve every tier
role. Both are `TEAM_SCOPABLE_PERMISSIONS` (10 §4.4): a tier agent holds them **team-scoped on their tier team**; a
workspace-wide custom-role grant is inert. "Tier 1/2/3 Agent" in the table means that team-scoped grant. API-key scope: `support` → `write:chat`; no
REST/MCP surface. Fleet Agent / Fleet Observer (20) get neither.

### 6.2 Enforcement (`lib/server/fork/account-actions/functions.ts`)

`requireAuth({ permission })` checks only workspace-wide resolved permissions (`functions/auth-helpers.ts:125-167`), so a
static `account.*` gate would reject a valid team-only grant before the team resolver runs. Ticket-context fns therefore
gate on authenticated **dashboard ticket access** and the domain authorizes team + tier (A1):

| Server fn | Static gate | Domain check (§4.5) |
| --- | --- | --- |
| `getAccountActionsPanelFn`, `listAccountRequestsFn` | `requireAuth({ permission: 'ticket.view' })` | `assertTicketVisible`; queue joins `ticketFilter(actor)`; capabilities per row via `canInTeam` |
| `requestAccountActionFn`, `cancelAccountRequestFn` | `requireAuth({ permission: 'ticket.view' })` | `assertTicketVisible`; `canInTeam(account.request)` on a qualifying membership; eligibility (§4.4); own request for cancel |
| `runAccountActionFn` | `requireAuth({ permission: 'ticket.view' })` | `assertTicketVisible`; `execTeams` or Owner/Admin break-glass; eligibility; binding hash |
| `decideAccountRequestFn` (approve/reject) | `requireAuth({ permission: 'ticket.view' })` | `assertTicketVisible`; `canDecide` against the current team; not self; binding hash |
| `resolveUnknownAccountActionFn`, `resendAccountActionFn`, `reconcileAccountActionFn` | `requireAuth({ permission: 'ticket.view' })` | `assertTicketVisible`; `execTeams` or Owner/Admin; not the requester for approved rows |
| `listConnectedAppsFn`, `upsertConnectedAppFn`, `rotateConnectedAppSecretFn`, `syncConnectedAppFn`, `testConnectedAppFn`, `updateActionDefinitionFn`, `upsertManualActionFn` | `integration.manage` (admin-only, `rbac-catalogue.ts:626`) | SSRF + schema subset |

The fns are thin wrappers; the domain functions are the single enforcement point and are what the tests call. All fns
carry a permission gate, so they appear in the authz matrix without an F-10 classification entry.

## 7. Seams

Shared seams used, not counted here: **F-4** (settings page), **F-5** (re-point `customer_principal_id`), **F-7** (two
keys), **F-8** (`fork-account-actions-sweep` job), **F-9** (`account_action.requested/approved/rejected/cancelled/expired/
executed/rebound/rerouted/reconciled/resolved/config_changed` in the fenced `AuditEventType` block), **F-12** (SSRF
allow-list for intranet hosts; hard prerequisite, I-1 — this plan adds no SSRF change of its own).

| ID  | Upstream file | Change (one line) | Why unavoidable | Re-apply on conflict | Phase |
| --- | --- | --- | --- | --- | --- |
| A-2 | `apps/web/src/components/admin/inbox/inbox-detail-panel.tsx` | Import + `<ForkAccountActionsSlot item />` after `<CompanyCard>` (`:467`), co-located with T-2 | No extension point in the panel | Re-insert after the `CompanyCard` render wherever it moved. | 5 |
| A-4 | _Optional_ `apps/web/src/components/admin/settings/security/audit-log-page.tsx` | Spread fork event labels into the filter list | Filter dropdown is curated; feed shows rows anyway | Re-add the spread. Skip if seam budget is tight. | 5 (optional) |
| A-5 | _Deferred (D-A7)_ `apps/web/src/lib/server/domains/assistant/assistant.runtime.ts` | `...forkAssistantSpecs` in the `extraSpecs` array (`:1085-1088`) | Assistant tool set is assembled in one call site | Re-add the spread to the array. | 7 (deferred) |

The staff-review corrections (team-aware auth, row shapes, reconciliation, resumable routing, transactional notification,
identity binding) need **no new upstream seams**: they use existing upstream exports (`assertTicketVisible`,
`createNotification(…, tx)`, `realEmail`, `requireAuth`) and fork-owned code. The intranet revision (I-1…I-7) removes
no seam here (none of A-2/A-4/A-5 depends on the network environment) and adds none; it depends on shared F-12 and
reads the upstream `account` / `identity_provider` tables and user attributes without edits. Removed: old **A-3** (People-profile slot,
D-A12); old A-1 → F-9; old A-5 (job spread) → F-8; old A-6 → A-5. Generated: `lib/shared/permissions.ts`
(`db:permissions`), `policy/authz-matrix/MATRIX.md` (16 gated fns), `policy/dep-graph/GRAPH.md`.

**Count (v1 core): 1 hand seam** (A-2) + 1 optional (A-4) + 1 deferred (A-5).

## 8. Phases

Authorization is team-aware in every runnable phase (A1); there is no interim workspace-wide fallback phase.

| Phase | Deliverable | Validation gate |
| --- | --- | --- |
| **0. Prerequisites** | Foundations (lineage, F-4/F-5/F-7/F-8/F-9) **and F-12** (SSRF allow-list; deployment sets `SSRF_ALLOWED_HOSTS`/`SSRF_ALLOWED_CIDRS` and `NODE_EXTRA_CA_CERTS`); 10 keys block + Tier templates **and 10 Phase 2 (`canInTeam`, team-scoped grants)**; 30 `fork_team_tiers`, `listTierMemberships`, `getTeamTier`, idempotent `escalateTicket` (`idempotencyKey`) | Fork drift check green; F-12 tests green (allow-listed intranet host passes, loopback/link-local still blocked); Tier templates grant `account.request` + `account.execute` team-scoped; `canInTeam` truth table green in 10 |
| **1. Keys, schema, connected apps** | 2 keys (Manager-excluded); 3 tables + migration (row-shape checks, `min_tier` 1..3); re-point registry entry; apps CRUD, secret generate/rotate (`secret_version`), `config_version` bumps, sync, manual actions, settings page | `db:permissions` diff = 2 keys; Manager lacks both; journal-integrity test; sync against stub receiver upserts/disables correctly and keeps admin overrides; suggested tier 7 → stored 3; subset validator rejects nested/secret/identity fields; `http:` URL, non-resolving host, loopback/link-local (even if allow-listed) and non-allow-listed host each rejected with their §4.2 message; allow-listed `https` host with a company-CA certificate syncs; untrusted certificate reports the CA hint |
| **2. Direct run** | `client.ts` execute + status lookup; `authorize.ts` (`execTeams`, `canInTeam`, visibility); eligibility + binding snapshot; state machine run path; reconciliation in the sweep; audit in tx | Stub receiver verifies HMAC + timestamp and enforces idempotency; full §4.3 outcome table incl. malformed 2xx/409 → `unknown`; `unknown` reconciled via lookup with the original id; retry refused while `unknown`; T2 team-scoped grant runs `min_tier=2`, T1 → 403, workspace-wide custom grant → 403; invisible ticket → 404; Owner out-of-tier run = `direct` + `break_glass` + NULL approver; payload carries `sso_subject` (and `employee_id` when configured); stub resolves by `sso_subject` first; never-signed-in email lead not eligible; double-submit same `client_request_id` = one call |
| **3. Request → approve** | Request/approve/reject/cancel; resumable routing + `escalateTicket`; current-team approval + re-route; break-glass; binding re-check | T1 requests `min_tier=2` → ticket on T2, T1 watches → T2 member approves → executes, both recorded; self-approve 403 (incl. Owner); non-team T2 403; Owner off-team approves with `break_glass`; concurrent approvals → 200 + 409; identity/URL/secret/definition change → `BINDING_CHANGED` and re-approval; crash after insert → routing resumed by replay and sweep, one escalation; ticket moved to another T2 team → that team approves; de-escalated to T1 → re-routed; ticket already on T3 → no escalation |
| **4. Expiry** | Sweep expiry + transactional notification, stuck-execution settle | Request at `expires_at` is `expired` within one cron tick; exactly one notification, rolled back with the transition on failure; approve after expiry → 409; stuck `executing` → `unknown` |
| **5. UI** | Slot A-2, panel, dialog, approval card (diff, unknown actions), queue page | Manual GUI walkthrough on ticket and paired conversation; unpaired conversation shows convert hint; panel invisible when off or without a team-scoped grant; queue hides tickets the viewer cannot see |
| **6. (Deferred) Quinn, D-A7** | `quinnEnabled` flag (default off), seam A-5, request-only spec handing off to the state machine. **Not part of the v1 capability set** — v1 is complete without it but offers no AI-initiated requests. | Flag off: no spec in the assembled tool set; flag on: Quinn can only create requests; human approver recorded |

## 9. Testing strategy

- **Unit**: state transitions table-driven (every from/to incl. illegal); `execTeams` / `canDecide` matrix (roll-up across
  several memberships, requester, Owner break-glass, member without team grant, team grant without membership,
  workspace-wide custom grant inert, Manager, raised `min_tier`, ticket on a different/lower team); eligibility (team
  member, service principal, no requester, never-signed-in email lead, unverified email, placeholder email, verified
  `contactEmail`, external id only); `sso_subject` selection (one enabled-IdP account → sent; no account, accounts at two
  enabled IdPs, disabled IdP, or a duplicate `(provider_id, account_id)` held by another user → `null`); `employee_id`
  (setting unset → `null`, attribute present/absent); binding hash (each material field incl. `sso_subject` and
  `employee_id` changes the hash; `name` / `sso_provider` do not); input-schema subset compiler
  incl. identity-field rejection; sync merge rules; `min_tier` clamp 1..3.
- **Contract**: zod contract schemas; a stub receiver that verifies signature and timestamp, reserves the idempotency key
  before side effects and serves the status lookup; **full response mapping table** — each row, plus malformed 2xx,
  malformed 409, `409 in_progress`, non-contract 4xx, 5xx, timeout, reset, oversize → `unknown`, and only contract
  rejections / pre-connect failures → `failed`; lookup `not_received` only after the 5-minute window; identity payload
  (`sso_subject` / `employee_id` present; widget `external_id` vs REST `_externalUserId` precedence and source;
  `email_verified`; attribute allow-list); stub receiver resolution order `sso_subject` → `employee_id` →
  `external_user_id` → verified email, and `customer_ambiguous` when two identifiers disagree.
- **Authorization (mandatory, A1)**: every server fn with a Tier agent holding only team-scoped grants (allowed where
  §4.5 says so — proves no static `account.*` gate); with a workspace-wide custom-role grant only (denied); with a
  ticket the actor cannot see (404) for panel, request, run, approve, reject, cancel, resolve, re-send, check now; queue
  omits invisible tickets.
- **DB tests (mandatory, A2)**: insert every §4.6 row shape and assert acceptance; assert rejection of `direct` with an
  approver, decided row with `decided_by = requested_by` (incl. break-glass), approved-mode `executing` without a
  decision, pending without `expires_at`; conditional-UPDATE race; unique `client_request_id`; audit row iff state change
  committed; `customer_principal_id` re-point on principal merge (fork completeness test) followed by `BINDING_CHANGED`.
- **Crash recovery (mandatory, A3/A4)**: kill after request insert (before escalation), after escalation (before
  `routed`), after `executing` (before the call), after the call (before settle), and during expiry — each recovers via
  replay/sweep with exactly one escalation, at most one external execution per idempotency key, and exactly one expiry
  notification. Concurrent approve vs expire vs cancel.
- **Security**: SSRF with F-12 — non-allow-listed private IP rejected at save and at call, allow-listed intranet host
  accepted, loopback / 169.254.169.254 / fe80:: rejected even when inside an allow-listed CIDR, host re-resolving to a
  non-allow-listed IP between save and call → `failed` / `NOT_SENT`; `http:` refused; TLS verification never disabled
  (self-signed without the CA → error); no redirect follow, response cap, secret never in DTOs or logs, identity never
  taken from `inputs`.
- **Offline**: the test suite and stub receiver run with no internet access (no external hosts in fixtures).
- **Guardrails**: authz-matrix snapshot, module-state scan, permissions mirror, dep-graph, 10's "no `can()` with a
  scopable key" lint, `single` + `pooled` runs.
- **Regression**: no rows in `assistant_pending_actions` / `assistant_tool_calls` after an account action; 30's escalation
  tests unaffected by `source: 'account_action'`.
- **Manual**: recorded walkthrough — T1 direct run, T1 request → T2 approve, reject, expire + notification, unknown →
  reconcile and → resolve, identity change → re-approval, admin sync with an action removed upstream, registering an app on a non-allow-listed
  host (clear error) and on an allow-listed host with a company-CA certificate.

## 10. Open items

No `D-A*` item is open in `01-decisions.md` "Still open". Items with an adopted default (🟡):

| ID | Question (default adopted in this plan) | Status |
| --- | --- | --- |
| **A-Q1** | Expiry notification reuses the existing `ticket_note_added` type (0 seams) rather than a new `NotificationType` (4 seams). Acceptable? | 🟡 adopted |
| **A-Q3** | May Owner/Admin **run** an account action directly above any tier they belong to, as an audited break-glass run recorded as a direct run (no approver), distinct from two-person approval? (O-A3) | 🟡 adopted: yes |
| **A-Q4** | Should actions a connected app newly advertises arrive **disabled** until an admin enables them? (O-A4) | 🟡 adopted: disabled |
| **A-Q5** | Which customer attributes beyond email, name and external user id may be sent to an app? (O-A5) | 🟡 adopted: none (empty per-app allow-list) |
| **A-Q9** | If a ticket moves teams after an account-action request, should approval follow the ticket's **current** team (re-routing the request if that team's tier is too low) rather than the team it was first routed to? | 🟡 adopted: current team; re-route |
| **A-Q10** | Which changes between request and execution require a fresh approval? | 🟡 adopted: any change to the customer's identifiers or allow-listed attributes, the inputs, the app's base URL / configuration version / signing-secret version, or the action definition version |
| **A-Q12** | Must connected apps use HTTPS, given internal apps may use certificates from the company's private CA? | 🟡 adopted: HTTPS required (`http:` refused); the company root CA is trusted process-wide via `NODE_EXTRA_CA_CERTS`; no per-app "skip TLS verification" option |
| **A-Q13** | Which identifier do connected apps resolve the employee by? | 🟡 adopted: the SSO subject (`account.account_id` at the enabled company IdP) first, then an optional employee id copied from an IdP claim into a workspace-configured user attribute, then external user id, then verified email; all sent, receiver uses the first present |

Closed (X-6): A-Q2 (job spread is shared F-8), A-Q6 (path fixed by contract; no per-definition override in v1), A-Q7
(30 exports `listTierMemberships` and aligned §4.2), A-Q8 (10 uses `account.request` / `account.execute`).

Closed (intranet, D-E3/D-E4): **A-Q11** (cold-email requesters) — moot: every requester is an employee with an SSO
account; a never-signed-in email lead becomes eligible on their first SSO sign-in (§4.4), with no OTP / magic-link step.
A-Q5 stands (attribute allow-list still defaults to empty; `employee_id` is sent through its own field, not the
allow-list).

## 11. Relationship to other v2 plans

- **10-rbac-persona-extensions** — fenced key block (F-7), "Tier 1/2/3 Agent" templates carrying team-scoped
  `account.request` + `account.execute`, and Phase 2's `canInTeam`, which every runnable phase here depends on (§8 Phase 0).
- **30-tiered-support** — tiers (`fork_team_tiers`; this plan uses 1..3, X-2), `listTierMemberships` / `getTeamTier` /
  current-team rule (30 §4.1), and `escalateTicket` with `source: 'account_action'`, `targetTier` and `idempotencyKey`
  returning the escalation id (30 §11); D-T1/D-T2/D-T3 semantics, and 30's claim on SSO sign-in that makes a
  never-signed-in email requester eligible (§4.4). This plan is its account-tooling layer.
- **04-intranet-deployment** — E-1 / shared seam **F-12** (SSRF allow-list) is a prerequisite; deployment also sets
  `NODE_EXTRA_CA_CERTS` for the company CA and the SSO-only sign-in baseline this plan's identity model relies on.
- **20-control-tower** — no surface in v1. A later MCP tool would register via F-3 and inherit human attribution (D-C2).
- **50 / 60** — independent (60 shares the fenced `AuditEventType` block, F-9).
