# Tiered Support (Tier 1/2/3) + Support Hub — v2 Design Plan

> **Status:** v2 (round 2) — supersedes `plans/v1/tiered-support-helpdesk-plan.md`. Plan only; nothing is implemented.
> **Depends on:** Foundations (fork migration lineage, `fork_settings`, shared seams F-1…F-7, `SEAMS.md`);
> `10-rbac-persona-extensions.md` Phase 1a (custom roles on REST/MCP) and Phase 2 (team-scoped RBAC, `canInTeam`) (D-T4).
> **Decisions applied:** D1, D2, D3, D4, D-T1 … D-T14, D-A8 (tier roll-up), D-A11 (account-action escalation), D-N5 (private
> portals). D-T8 is 🟡 (default adopted, flagged). D-T11 is decided: option B (hub landing + links).
> Baseline: upstream `780a7b577`. Claims that are new in round 2 were checked against `92fb29335` (current checkout).
> **Conventions:** `02-fork-conventions.md` is binding.

## Round-2 changes

| Change | Driver |
| --- | --- |
| T1 intake by workflow is confirmed. Enabling tiered support now **requires** workspace auto-routing to be off (§4.6). OI-1 closed. | D-T5 ✅ |
| Seam T-1 (escalator keeps read access while watching) is approved. The sign-off caveats are removed and OI-10 is closed. | D-T6 ✅ |
| Managers hold `ticket.escalate` workspace-wide. It is **not** in the `WORKSPACE_ADMIN_PERMISSIONS` exclusion. OI-3 closed. | D-T7 ✅ |
| De-escalation is allowed only for agents on the tier that currently holds the ticket, with roll-up applied (§4.2 step 3). OI-4 closed. The remaining question is tracked under D-T8. | D-T8 🟡 |
| No automatic de-escalation. | D-T9 ✅ |
| Everything starts at T1. There is no skills or attribute routing and no intake to T2/T3. OI-11 removed. | D-T10 ✅ |
| The hub is **option B**: a landing page that runs find an answer → still need help → track → rate, with the announcements strip at the top. A widget Home section links into the existing pages. Option A is recorded as a rejected alternative (§4.10). OI-5 closed. | D-T11 ✅ (coordinator) |
| Signed-out and email-only requesters use the hub through passwordless sign-in. They can reach **only their own requests**, even on private portals (§4.11). OI-6 closed. | D-T12 ✅, D-N5 |
| Channels phase and OI-7 removed. | D-T13 ✅ |
| The balanced-distribution limitation is accepted. OI-8 closed. | D-T14 ✅ |
| `assignTierAgent` / `removeTierAgent` domain service (membership + workspace-wide Tier role + team-scoped grant), exposed to 10's `assignTierAgentFn` and to 20's `sync-members` via fork MCP tools (§4.12). | coordinator (20, 10) |
| **Effective tier** is defined (highest tier across a principal's tier-team memberships). `listTierMemberships(principalId)` → `[{teamId, tier}]` is exported for 40's per-team checks, with `getEffectiveTier` as a convenience built on it (§4.1). A top-tier agent's Escalate is a disabled no-op. | D-A8 ✅ |
| §4.2 now matches the §11 contract: `escalateTicket` performs no permission check. Callers authorize (`escalateTicketFn` → `assertCanEscalate`; 40 → `account.request`). | coordinator |
| The `escalateTicket` contract (§11) keeps `source: 'account_action'` and adds `targetTier` so that 40 can move the ticket to the tier that can approve. | D-A11 ✅ |
| Principal re-point is handled by the conventions §8 / F-5 registry (exemptions only). OI-9 closed. | 02 §8 |
| The Tiers settings page registers through **F-4**, so it is no longer an own seam (S3 dropped). The MCP tool registers through F-3. | 02 §10 |
| OI-2 is closed by 10's design: team-scoped rows are invisible to `requireAuth({permission})`, so `escalateTicketFn` gates on `ticket.view` and the service calls `canInTeam` (§6). | 10 §4.4 |
| Seam IDs are aligned with `SEAMS.md` (S1→T-1, S2→T-2). | — |

## 1. Changes from v1

| # | v1 issue (review §3.4 + follow-up) | v2 resolution |
| --- | --- | --- |
| 1 | **Blocker:** tier routing strategy. `RoutingResult` returns an agent only (`routing.types.ts:17-22`). `settings.conversation-routing.ts:17,22,36,58,82` hard-codes `auto_assign_active`. `assignRoutedConversation` (`conversation.service.ts:1454-1474`) only claims the agent column. | **No routing change.** T1 intake is a workflow (`conversation.created` / `assistant.handed_off` → `assign_team` T1 + `apply_sla`). That is data, not code (D-T5). Workspace auto-routing must be off while tiers are on (§4.6). |
| 2 | Conversation and ticket have separate assignees (`schema/conversation.ts:61,66`; `schema/tickets.ts:112-114`). `assignTicket` (`ticket.service.ts:744-800`) never runs team distribution and is gated by `ticket.assign`. Conversation assignment is gated by `canActAsAgent` (`policy/conversation.ts:55-58`). Balanced distribution counts conversations only. | `escalateTicket` updates **both** sides. It calls `assignTeam` on the paired conversation, which runs `distributeToTeamMember` (`team-distribution.ts:43-66`) and publishes the update and events. It then calls `assignTicket` with the same team and agent, under a narrowly widened actor (§4.2). The balanced-load limitation is accepted (D-T14). |
| 3 | `applySlaToConversation` resets clocks on re-apply (`sla.service.ts:162-219`), and so does `applySlaToTicket` (`ticket-sla.service.ts:270`). | **D-T1:** escalation never calls either function while an SLA is active (§4.4). Per-tier attainment comes from the tier timeline. |
| 4 | Clearing the agent hides the ticket from a T1 agent who has only `*.view` (`policy/tickets.ts:44-62`, `policy/conversations.ts:36-50`). `assignTeam` never clears the agent (`conversation.service.ts:1573-1576`). | **D-T2/D-T6:** the service clears the agent explicitly. The escalator is auto-watched, and seam T-1 grants "escalated-by-me AND still watching" visibility (§4.5). |
| 5 | The `escalate` workflow/macro action was treated as cheap. It is a closed union across about 15 sites, and `MacroAction` has no ticket actions (`schema/macros.ts:38-45`). | Manual escalation ships first. Automated escalation is a later, seam-counted phase (Phase 6). |
| 6 | v1 emitted a new `escalated` event and trigger (`events/CONTRACT.md` §1). | **No new event and no new trigger.** The existing `conversation.assigned`, `ticket.assigned` and `conversation.attribute_changed` events are reused (§4.3). |
| 7 | Columns on `teams`; `origin_tier` on conversations/tickets | Sidecar `fork_team_tiers` plus the ledger `fork_support_escalations` (§5). No upstream schema edits. |
| 8 | Escalation reason stored in an ad-hoc way | A seeded conversation-attribute definition `fork_escalation_reason`, created with the pattern at `conversation-attribute.service.ts:121-148`. This is data only. |
| 9 | New `tier` view rule plus inbox filter | Views are **seeded as data**, one per tier team, using the existing `team` rule (`lib/shared/conversation/views.ts:109-121,190,287`). |
| 10 | "`createMyTicket` is in `ticket-intake.service.ts`" | It is in `requester.service.ts:305`. `createTicketCore` is at `ticket-intake.service.ts:127`. |
| 11 | "Stage changes are in-app badges only" | The bell and the resolution email already exist (`events/targets.ts:876-920`, `:1488`). The gap is email for stage crossings that are not closes (Phase 8). |
| 12 | The hub was treated as greenfield | `routes/_portal/support.index.tsx` and `components/widget/widget-tickets.tsx` already exist. The hub is fork components behind a few slots (§4.10). |
| 13 | Tier analytics in `domains/analytics` (42 commits in 90 days) | A fork reporting page (§4.7). |
| 14 | `support.escalate` (a 3-part key) | `ticket.escalate` (2-part, category `support`). |
| 15 | Upstream migration sequence; `esc_` TypeID | Fork lineage; uuid PK (conventions §3). |
| 16 | "Strong upstream-contribution candidates" | D1: fork-only. |
| 17 | Churn not considered | Hot files are kept out of scope (90-day churn: `conversation.service.ts` 51, `ticket.service.ts` 32, `workflow-graph.ts` 25, `inbox-detail-panel.tsx` 25, `action.executor.ts` 20, `inbox-scope.ts` 16). |
| 18 | Channels and hub scope unanswered | Channels are dropped (D-T13). The hub is scoped by D-T11/D-T12 (§4.10–4.11). |

## 2. Requirements

| # | Requirement | Phase |
| --- | --- | --- |
| R1 | Tier 1/2/3 as a typed property of teams (several teams may share a tier), with an escalation edge and an optional default SLA. Effective tier per principal (D-A8). | 1 |
| R2 | Escalate / de-escalate a **ticket** between tier teams. A ticket-less conversation is converted first (D-T3). A reason is captured, and there is an append-only ledger. De-escalation only by the holding tier (D-T8 🟡). Nothing de-escalates automatically (D-T9). | 2 |
| R3 | SLA **carries** across escalations (D-T1). A tier's default SLA applies only where no SLA is active. | 2 |
| R4 | The previous agent is cleared (D-T2). The escalator keeps read access while watching (D-T6). | 2 |
| R5 | Everything starts at T1 via workflows; auto-routing is off while tiers are on (D-T5, D-T10). | 3 |
| R6 | Tier queues (seeded views) and per-tier reporting. | 4–5 |
| R7 | Automated escalation (workflow/macro action; up only, D-T9). | 6 |
| R8 | End-user hub (D-T11 B) with passwordless access to own requests for signed-out and email-only requesters (D-T12); email on non-close stage changes. No extra channels (D-T13). | 7–8 |
| R9 | Single and pooled tenancy; passes all upstream CI guardrails; ships dark behind `fork_settings`. | all |

## 3. What already exists (reused, not rebuilt)

- **Teams:** `assignment_method` manual/round_robin/balanced (`schema/teams.ts:31-60`). Membership is `team_members`
  (`schema/teams.ts:71`). Distribution: `distributeToTeamMember(team)` (`team-distribution.ts:43-66`).
- **Conversation team assign:** `assignTeam` (`conversation.service.ts:1542-1609`), which never clears the agent. Agent
  assign: `assignConversation` (`:1477-1532`).
- **Ticket assign:** `assignTicket` (`ticket.service.ts:744-800`). It publishes, emits `ticket.assigned` and records
  `ticket_activity` with from/to team. It also stamps `firstResponseAt` for team-member actors (`:774-775`).
- **Watchers:** `ticket_subscriptions`, with reasons `'requester'|'assignee'|'replier'|'manual'`, set through
  `safeSubscribeToTicket` (`ticket-subscription.service.ts:85`). A watch triggers notifications but grants no visibility.
- **Conversion:** `createTicketCore` + `linkTicketToConversation` (`ticket-conversation-link.service.ts:98`).
- **Pair lookup:** `getLinkedCustomerTicket` (`inbox/inbox.query.ts:647`); `resolvePairConversationId` (`pair-thread.service.ts:122`).
- **SLA:** `applySlaToConversation` (`sla.service.ts:162`), `applySlaToTicket` (`ticket-sla.service.ts:270`), and `sla_events` (`schema/sla.ts:61-92`).
- **Notes / attributes:** `addTicketNote` (`ticket-message.service.ts:481`); `setConversationAttribute` (`set-attribute.service.ts:124`).
- **Widened-actor precedent:** `ticketActionActor` (`action.executor.ts:130-136`) + `TICKET_ACTION_PERMISSIONS` (`workflow-actor-permissions.ts:44-47`).
- **Routing settings:** `ConversationRoutingConfig { enabled, strategy }` (`settings.conversation-routing.ts:15-23`);
  `updateConversationRoutingFn` (`functions/settings.ts:936`, `settings.manage`).
- **Passwordless auth (D-T12):** Better-Auth `magicLink` and `emailOTP` plugins (`lib/server/auth/index.ts:5,7`, configured at
  `:647-700`). The portal's own sign-in is `POST /api/auth/portal-signin` (`routes/api/auth/portal-signin.ts:85-106`: it rate-limits,
  then calls `requestEmailSignin`). `requestEmailSignin` (`auth/email-signin.ts:36`) sends one email containing both a link and a
  6-digit code. It first checks `isAccountCreationAllowed(email, 'portal')` (`:66`; `signup-policy.ts:191`) and does not
  enumerate: a refused address gets a "sign-up not allowed" email instead.
- **Private-portal gate:** `evaluatePortalAccess` (`domains/settings/portal-access.ts:149-213`). On a private portal it grants
  access to team members, a verified email on an allowed domain, an accepted invite, an allowed segment, or a widget handoff.
  Everyone else is `unauthorized`. It is enforced for the whole `_portal` layout (`routes/_portal.tsx:121`) and again in the
  visitor server functions (`functions/conversation.ts:261-266` `assertVisitorConversationAccess`; `runGetMyConversations`
  `:582-586` returns empty when access is not granted).
- **Requester-scoped reads:** `listConversationsForVisitor(principalId, …)` (`conversation.query`, used at `functions/conversation.ts:590`),
  `listMyTicketSummaries` (`requester.service.ts:239`), and `loadOwnedTicketOr404` (`:114-118`, requires `requesterPrincipalId === me`).
- **Email-only requesters:** a cold inbound email with no matching user becomes an **anonymous lead principal with no user row**
  that carries `contactEmail` (`conversation.email-cold-inbound.ts:74-135`). Signing in later creates a separate user principal. No
  automatic merge exists for this case. The admin merge `mergeLeadIntoUser` (`domains/users/user.merge.ts:38`) re-points through the
  registry, and F-5 covers fork tables.

## 4. Design

### 4.1 Tier model and effective tier

`fork_team_tiers` is a 1:1 sidecar on `teams` (§5). A team with no row is untiered. Tiers are numbered `1..9`, and the UI shows
T1–T3 by default. Several teams may share a tier. Each team has its own `escalates_to_team_id` edge, which must point to a higher
tier. Cycles are rejected. Soft-deleted teams are ignored.

**Current tier of a ticket** is the tier of `tickets.assignee_team_id`. If that is null, it falls back to the paired
conversation's `assigned_team_id`, because T1 intake sets only the conversation side. If both are null, the ticket is "intake"
(untiered).

**Tier memberships and effective tier (D-A8).** A principal's tier memberships are every non-deleted tiered team where they
have a `team_members` row. Their **effective tier** is the highest tier among those, or null if there are none. An agent at
effective tier N may do everything allowed at tiers ≤ N. Exported from `lib/server/fork/tiered-support/tiers.ts`:

```ts
listTierMemberships(principalId: PrincipalId): Promise<Array<{ teamId: TeamId; tier: number }>>
getEffectiveTier(principalId: PrincipalId): Promise<number | null> // = max(listTierMemberships(p).tier) ?? null
getTeamTier(teamId: TeamId): Promise<number | null>
resolveTeamForTier(minTier: number, fromTeamId?: TeamId): Promise<TeamId | null>
// follows escalates_to edges from fromTeamId until tier >= minTier; else the lowest-tier team with tier >= minTier
```

All of these are pure reads with no caching, following the module-state rule. 40 uses `listTierMemberships` to check
team-scoped `account.execute` per team: some membership `{teamId, tier}` must have `tier ≥ min_tier` and
`canInTeam(actor, 'account.execute', teamId)`. 40 uses `resolveTeamForTier` to find the approving team (D-A11). §4.2's
`assertCanEscalate` uses `listTierMemberships` in the same way.

### 4.2 `escalateTicket` (fork domain service, `lib/server/fork/tiered-support/escalation.service.ts`)

Input: `{ subject: {ticketId} | {conversationId}, toTeamId?, targetTier?, direction?: 'up'|'down', reason, note?,
expectedFromTeamId, source: 'manual'|'workflow'|'mcp'|'account_action', idempotencyKey? }`, plus an actor.

1. **Resolve the subject (D-T3).** For a `conversationId`, look up `getLinkedCustomerTicket`. If there is no ticket, convert with
   `createTicketCore` + `linkTicketToConversation`, seeding the team and agent from the conversation.
2. **Resolve from/to.** The from-team is determined as in §4.1. The target is chosen in this order:
   - `toTeamId`, if given;
   - else `targetTier`, through `resolveTeamForTier(targetTier, fromTeamId)`;
   - else `up`, which follows `escalates_to_team_id`;
   - else `down`, which picks the unique tier team whose edge points at the from-team (if several match, `toTeamId` is required).

   If `expectedFromTeamId` doesn't match the current from-team, the call fails with `CONFLICT`. If the ticket is already on the
   target team, the call is a no-op. `direction` is derived from the from- and to-tiers.
3. **No permission check here (the §11 contract).** `escalateTicket` trusts its caller, and each caller authorizes before
   calling:
   - `escalateTicketFn` (manual UI and MCP) calls `assertCanEscalate(actor, fromTeamId, toTeamId, direction)`:
     - **Workspace-wide `ticket.escalate`** (Owner/Admin/**Manager**, D-T7) may escalate or de-escalate any tiered ticket.
     - **Team-scoped holders** need a membership `{teamId: T, tier}` from `listTierMemberships` with
       `tier ≥ tier(from-team)` and `canInTeam(actor, 'ticket.escalate', T)`. That team's own members count, and so do higher
       tiers through roll-up (D-A8). This applies **in both directions**, so a ticket returned to T1 cannot be pushed back down by
       T1 (**D-T8 🟡**).
     - `ticket.assign` is also required when the from-team is untiered, or when the target is off the edge (an override).
   - The Phase 6 workflow action authorizes through the widened workflow actor (`workflow-actor-permissions.ts`).
   - 40's request flow checks `account.request` (§11).

   **Top tier.** Roll-up gives a T3 agent `ticket.escalate`, but a T3 team has no `escalates_to_team_id`. For a top-tier
   from-team, `up` with no `toTeamId` or `targetTier` is a **no-op**, and the panel shows Escalate disabled ("Highest tier").
   De-escalate stays available (D-T8).
4. **Escalation actor.** A copy of the human actor whose `permissions` add `ESCALATION_AUTHORITY = {ticket.assign, ticket.create,
   ticket.note, conversation.reply}`. The principal is unchanged, so every event is attributed to the human.
5. **Conversation side** (only if paired): `assignTeam(convId, toTeamId, escActor)`. If distribution picked nobody and the old
   agent is still set, call `assignConversation(convId, null, escActor)` (D-T2).
6. **Ticket side:** `assignTicket(ticketId, { assigneeTeamId, assigneePrincipalId: <agent from step 5, else
   distributeToTeamMember for an unpaired ticket, else null> }, escActor)`. Balanced mode counts conversations only, which is
   accepted (D-T14).
7. **SLA** (§4.4).
8. **Record.** Insert a `fork_support_escalations` row. Set the `fork_escalation_reason` attribute on the ticket and on the
   paired conversation. Add an internal note "Escalated T1 → T2 (reason): note".
9. **Watch (D-T2).** `safeSubscribeToTicket(actor.principalId, ticketId, 'manual')`.
10. **Return** `{ escalationId, fromTeamId, toTeamId, direction }`.

Steps 5–9 run sequentially and each is idempotent, because the upstream helpers are not transaction-aware. The ledger has
`UNIQUE (ticket_id, idempotency_key)`, and a retry re-runs steps 7–9.

**No automatic de-escalation (D-T9).** No workflow, timer or status change moves a ticket down. Phase 6 automation is **up-only**.

### 4.3 Escalation reason

`ensureForkEscalationReasonAttribute()` inserts `key='fork_escalation_reason'` (select, `sourceHint='agent'`, options
`needs_expertise`, `access_required`, `suspected_bug`, `customer_request`, `sla_risk`, `account_action`, `other`). It is
idempotent, following `conversation-attribute.service.ts:121-148`. The `account_action` option is used when `source='account_action'`.
Admins can edit the options on the existing Conversation data page. The ledger stores the option id plus a label snapshot.

### 4.4 SLA (D-T1)

- Escalation never calls `applySlaToConversation` or `applySlaToTicket` on a side whose SLA is active.
- If the target tier has a `default_sla_policy_id` and a side has no active SLA, that side gets the policy. Each side is judged
  independently.
- The T1 default is applied at intake by the workflow's own `apply_sla` action.
- The UI shows the carried SLA's policy name and deadline next to the tier badge.

### 4.5 Visibility for the escalator (D-T2, D-T6 — seam T-1 approved)

- `ticketFilter` (`policy/tickets.ts:44-62`) handles ticket lists and the single-ticket read. For a `ticket.view` holder it allows
  only tickets assigned to them or to their team. `canViewConversation` (`policy/conversation.ts:25-29`) already allows any
  `conversation.view` holder to deep-link.
- **Seam T-1:** one term, `OR ${forkEscalatedByMeFilter(principalId)}`, in branch (3) of `ticketFilter`. It is a pure SQL predicate
  that matches when `fork_support_escalations.by_principal_id = me` **and** my `ticket_subscriptions` row still exists. Unwatching
  therefore revokes the access, and other watchers gain nothing. It also covers an account-action requester (D-A11), because 40
  escalates with the requester as the actor.
- A fork page, **"Escalated by me"** (`listMyEscalationsFn`), supports discovery. No conversation-list seam is added.

### 4.6 T1 intake (D-T5, D-T10)

- **Seeded, disabled workflows (data):**
  - `conversation.created` → `assign_team: <T1 team>` + `apply_sla: <T1 default>`;
  - `assistant.handed_off` → the same.

  The admin reviews and enables them on the Tiers page. **Everything starts at T1.** There is no skills, attribute or condition
  routing to T2/T3 (D-T10), and the seeded workflows carry no branches.
- **Auto-routing off (D-T5).** `setTieredSupportEnabled(true)` refuses while `getConversationRouting().enabled` is true. The Tiers
  page offers a "Turn off auto-routing" button that calls upstream `updateConversationRoutingFn` (no seam; `settings.manage`).
  Upstream's routing page can still switch routing back on. To catch that, the Tiers page and the Tiers report show a
  persistent warning banner whenever both are on. There is no routing code change.
- **Limits until Phase 6:** a workflow `assign_team` moves only the conversation team and writes no ledger row. The §4.1 fallback
  keeps the tier correct, and the timeline also reads `ticket_activity`.

### 4.7 Queues and reporting

- **Queues:** one shared `conversation_views` row per tier team, `{rules:[{field:'team',value:teamId}]}`, named "T2 · <team>".
- **Tier timeline:** computed at read time from `fork_support_escalations`, then `ticket_activity` `ticket.assigned`, then the
  current team. The origin tier is always T1 for new work (D-T10). Legacy or manual work may start untiered.
- **Metrics** (`routes/admin/fork-tiers.tsx`, `analytics.view`):
  - time in tier;
  - escalation rate and de-escalation rate;
  - per-tier SLA attainment: each `sla_events` row is attributed to the tier the subject was in at `at`;
  - CSAT by final and origin tier;
  - count of escalations with `source='account_action'`.

  No `domains/analytics` edits.

### 4.8 Agent UI and settings

- **Seam T-2:** a `<ForkTierPanel item={…} />` line in `inbox-detail-panel.tsx` after the Watchers row (`:672-676`). The panel
  shows the tier badge, the carried-SLA chip, Escalate ▸ / De-escalate ▸ (De-escalate is hidden unless `assertCanEscalate` would
  pass for `down`), and the escalation history. 40's `ForkAccountActionsSlot` (A-2) mounts in the same file. Both plans should
  share **one** fork slot component there (coordinator note).
- **Settings via F-4:** `fork-settings-modules.ts` adds the **Tiers** page (`routes/admin/settings.fork-tiers.tsx`, `team.manage`)
  to the existing Support module. It covers per-team tier, edge, default SLA, seeded views/workflows, the routing check, and links
  to the report and to "Escalated by me". There is no own seam.

### 4.9 Feature gating

`fork_settings` key `tiered_support.enabled` (default false) for Phases 1–6. `tiered_support.hub_enabled` (default false) for
Phase 7. No Labs line is needed. T-1 matches nothing while no escalations exist.

### 4.10 End-user hub (D-T11 ✅ option B)

**Prototype:** https://claude.ai/artifact/XAn1u4GewieesuMGHsua43

**Shape.** A new hub landing page, plus a widget Home section. Both link into the existing upstream pages, which stay unchanged.
The landing runs one chain, top to bottom:

| # | Section | Content | Backed by (no upstream edit) |
| --- | --- | --- | --- |
| 0 | Announcements strip | 60's banner | `<ForkAnnouncementsBanner/>` (fork component from 60), mounted in the hub layout. There is no N-1 dependency because the hub is outside `_portal`. |
| 1 | Find an answer | KB search, Ask AI, help-center collections | Upstream `components/help-center/help-center-search.tsx` and `ask-ai.tsx` imported as-is. Collection cards link to `/hc/$locale/collections/$idSlug`. **Shown only when the viewer has portal access** (OI-15). `/hc` is behind the `_portal` gate. Ask AI posts to `/api/widget/kb-ask`, which does not itself call `resolvePortalAccessForRequest` (`kb-ask.ts:208-210`), so the hub hides the section itself. |
| 2 | Still need help | Start a chat · Submit a request | "Start a chat" links to `/support` (granted viewers) or opens the widget messenger. "Submit a request" uses a hub form → `createMyTicket` (`requester.service.ts:305`), so ungranted passwordless requesters can file too. |
| 3 | Track | My requests, including chats, with stage chips and "View all" | `listConversationsForVisitor(me)` + `getRequesterTicketSummaries` / `listMyTicketSummaries` with `StageChip`. Rows open `/hub/requests/$id` (hub detail and reply, §4.11). "View all" goes to `/hub/requests`. Granted viewers also get a link to `/support`. |
| 4 | Rate | CSAT for the most recently resolved request | The upstream CSAT submission domain call (as `submitCsatFn`, `functions/conversation.ts:808`) behind a hub function (§4.11). |

**Routes.** `routes/_fork-hub.tsx` (a pathless layout) plus `routes/_fork-hub/hub.tsx`, `hub.requests.tsx` and
`hub.requests.$id.tsx`, giving URLs `/hub`, `/hub/requests` and `/hub/requests/$id`. New route files never conflict because
`routeTree.gen.ts` is gitignored. The hub sits **outside** `_portal` because the `_portal` gate (`routes/_portal.tsx:121`) would
wall off a passwordless requester with no portal grant on a private portal (§4.11). The layout composes the portal look by
importing `PortalHeader` (`components/public/portal-header.tsx:63`) and the portal intl/theme helpers (no seam).

**Branding (D-X1, conventions §11).** The hub must look like the rest of that app's portal and change with it. The
`_fork-hub` layout loader builds exactly what the portal loader builds (`routes/_portal.tsx:217-260`):
`generateWorkspaceThemeCSS(brandingConfig, visualTheme)`, `customCss` (applied after the theme), `themeMode`, logo,
favicon, and fonts via `PortalBrandingFontLoader` / `readFontSans`. All hub and widget-section components use only
theme tokens (`bg-background`, `bg-card`, `text-foreground`, `bg-primary`, `border-border`, `rounded-[var(--radius)]`,
…) and upstream `components/ui/*` primitives. The prototype's colours are illustrative. Validation: change an app's
primary colour, font and custom CSS once in admin branding and confirm `/hub`, the widget Home section and `/support`
all change together, in light and dark mode.

**Entry points.**

- The portal header gets a "Help hub" link (T-7).
- The widget Home (`widget-overview.tsx`) gets a section after the recent-tickets card (T-6). It shows "Find an answer" (opens
  the widget Help tab), "Still need help" (opens Messages / new ticket), and "Your requests" (opens the Tickets tab, or `/hub` in
  a new tab for anonymous widget visitors). The section is lean, with no Tiptap, to respect the widget bundle budget.
- Phase 8 stage emails link to `/hub/requests/$id`.

**Rejected alternative (A):** replace `/support`, `/hc` and the widget tabs with one hub. That meant about 10 seams in hot
portal and widget files, versus 5 for B.

### 4.11 Passwordless requester access (D-T12, private portals D-N5)

**Goal:** a signed-out visitor, or someone who has only ever emailed support, can open `/hub`, prove ownership of their email,
and see **only their own** conversations and tickets. They get no other portal access, not even on private portals.

1. **Sign-in.** The hub's signed-out state is an email form that posts to upstream `POST /api/auth/portal-signin` with
   `callbackURL=/hub` (`portal-signin.ts:85-106`). That route applies rate limiting and does not enumerate addresses. The
   requester clicks the link or enters the 6-digit code (Better-Auth `magicLink` / `emailOTP` `sign-in`). The resulting session is a
   normal portal user (`role: 'user'`) whose address is verified by inbox proof. **The Phase 7 gate asserts `emailVerified=true`
   after both paths.**
2. **Closed sign-up.** If `openSignup` is false for the portal (likely on private portals), `isAccountCreationAllowed` refuses an
   address that has no user row. Its exemptions are an existing user, a pending invite, an allowed domain, or bootstrap
   (`signup-policy.ts:191-250`). An email-only requester is a lead with no user row, so they would receive "sign-up not allowed".
   **Seam T-4** adds one exemption line:
   `if (await forkIsKnownRequester(normalised)) return true`.
   It is true when an anonymous lead principal with `userId IS NULL` and `contactEmail = email` exists and owns at least one
   conversation or ticket. The same no-enumeration property holds, because the caller's behaviour (one email) is unchanged.
3. **Claim leads.** On the first authenticated hub load, `claimMyRequesterLeadsFn` runs. For a session user with
   `emailVerified=true`, it finds lead principals (`type='anonymous'`, `userId IS NULL`, `contactEmail = session email`) and calls
   upstream `mergeLeadIntoUser(lead, me)` (`user.merge.ts:38`). Their conversations and tickets then belong to the requester, and fork
   tables are covered by F-5. This call is idempotent. Whether unverified (weak-DMARC) leads are included is flagged as OI-14.
4. **Scope, not portal access.** Hub server functions (`lib/server/fork/hub/functions.ts`) use bare `requireAuth()` and reject
   team members and anonymous principals. They **do not** call `resolvePortalAccessForRequest`. Instead they call the upstream
   domain reads that are already scoped to the caller: `listConversationsForVisitor(me)`, `listMyTicketSummaries`, and the
   `loadOwnedTicketOr404` / visitor-conversation ownership checks. Writes (reply, CSAT, new ticket) call the same domain entry points
   the upstream visitor functions call **after** their portal gate. They also keep upstream's other visitor checks:
   conversations/tickets enabled, and `isBlocked` (as in `functions/conversation.ts:275-281`). The requester therefore reaches their
   own requests and nothing else. `evaluatePortalAccess` is **unchanged**, so `/support`, `/hc`, the boards and the other `_portal`
   routes still show the private-portal wall to this user.
5. **Authz matrix.** Bare `requireAuth()` gates need `END_USER` classifications (upstream precedent:
   `classifications.ts:166,172` for `createMyTicketFn` / `getMyTicketFormFn`). **Seam T-3** is one spread,
   `...FORK_CLASSIFICATIONS`, into the classifications record. It is a candidate for a shared foundation seam (coordinator).
6. **Widget.** Widget sessions (`scope === 'widget'`) already bypass the portal gate upstream, so their requests show in the
   widget. The Home section links anonymous widget visitors to `/hub`, which opens in a new tab on the portal domain.
7. **Drift guard.** A fork test mirrors the upstream visitor functions' check list (enabled flags, `isBlocked`, ownership). It
   fails if upstream adds a check to `runSendConversationMessage` / `runGetMyConversation` that the hub does not replicate.
8. **Knowledge base and Ask AI.** `/hc` and Ask AI stay behind the private-portal gate. For requesters without a grant, the hub
   hides "Find an answer" (OI-15).

### 4.12 Tier agent assignment (for 10's `assignTierAgentFn` and 20's `sync-members`)

A domain service in `lib/server/fork/tiered-support/tier-agents.service.ts`. Callers authorize, as with `escalateTicket`.

```ts
assignTierAgent(principalId: PrincipalId, teamId: TeamId, actor: Actor): Promise<void>
removeTierAgent(principalId: PrincipalId, teamId: TeamId, actor: Actor): Promise<void>
```

- **Assign.** The target must be a tiered team, whose tier N selects the "Tier N Agent" template role. The service then:
  1. adds the principal to the team's membership through upstream `setTeamMembers(teamId, current ∪ {p})`
     (`team.service.ts:205`, which validates teammates). It reads `listTeamMemberPrincipalIds` (`:196`) first, under
     `pg_advisory_xact_lock(team)`, because the setter replaces the whole set;
  2. assigns the Tier N role **workspace-wide** (dashboard keys);
  3. grants the same role **team-scoped** on `teamId` (scopable keys: `ticket.escalate`, `account.request`, `account.execute`).

  Steps 2 and 3 use 10's writers (`grantTeamRoleFn` domain core, `assertGrantableRole`) and audit through `user.role.changed`.
  The operation is idempotent.
- **Remove.** Undo in reverse order: revoke the team-scoped grant, then remove the team membership. The workspace-wide Tier N role
  is removed **only if** the principal is no longer on any tier-N team. Effective tier is recomputed implicitly, because it is
  derived from membership (§4.1).
- **Callers:**
  - 10's `assignTierAgentFn` / `removeTierAgentFn` (`member.manage`), the admin UI;
  - fork MCP tools `fork_assign_tier_agent` / `fork_remove_tier_agent` in `mcp/tools/fork-tiered-support.ts` (registered via F-3,
    `member.manage`). The tower's `sync-members` calls these tools with the admin's own token, so the change is attributed to
    the human (D-C2).

## 5. Data model (fork lineage `packages/db/drizzle-fork/`)

Schema: `packages/db/src/fork/schema/tiered-support.ts`, exported from the fork barrel.

**`fork_team_tiers`** (1:1 sidecar)

| Column | Type | Notes |
| --- | --- | --- |
| `team_id` | `typeIdColumn('team')` **PK** | FK `teams.id` ON DELETE CASCADE |
| `tier` | `smallint` not null | CHECK `tier BETWEEN 1 AND 9` |
| `escalates_to_team_id` | `typeIdColumnNullable('team')` | FK SET NULL; CHECK `<> team_id` |
| `default_sla_policy_id` | `typeIdColumnNullable('sla_policy')` | FK SET NULL |
| `updated_at`, `updated_by_principal_id` | timestamptz, principal FK SET NULL | |

Index: `(tier)`.

**`fork_support_escalations`** (append-only ledger)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK `defaultRandom()` | |
| `ticket_id` | `typeIdColumn('ticket')` not null | FK CASCADE |
| `conversation_id` | `typeIdColumnNullable('conversation')` | FK SET NULL |
| `from_team_id` / `to_team_id` | team FKs, SET NULL | `to_team_id` NOT NULL on insert |
| `from_tier` / `to_tier` | `smallint` null | snapshots |
| `direction` | `text` CHECK in (`up`,`down`,`lateral`) | |
| `reason` / `reason_label` | `text` not null / `text` | |
| `note` | `text` null | ≤ 2,000 chars |
| `by_principal_id` | principal FK SET NULL | null = system |
| `source` | `text` CHECK in (`manual`,`workflow`,`mcp`,`account_action`) | `workflow` from Phase 6; `account_action` from 40 |
| `idempotency_key` | `text` null | UNIQUE `(ticket_id, idempotency_key)` |
| `created_at` | timestamptz default now() | |

Indexes: `(ticket_id, created_at)`, `(by_principal_id, created_at)`, `(to_team_id, created_at)`, `(created_at)`.

- **Migration:** `drizzle-fork/000N_tiered_support.sql`, additive only, with no notify-claim columns.
- **Principal re-point (conventions §8, F-5):** entries in `fork/principals/fork-repoint.ts`:
  - `fork_support_escalations.by_principal_id` → **exempt**. It is a staff reference, and upstream merges only anonymous →
    identified.
  - `fork_team_tiers.updated_by_principal_id` → **exempt**. Also staff.

  The hub adds no fork tables. Customer data moves through upstream `mergeLeadIntoUser`.
- `fork_settings` keys: `tiered_support.enabled`, `tiered_support.hub_enabled`.

## 6. Permissions

| Key | Category | Owner/Admin | Manager | Contributor | Tier roles | Enforced at |
| --- | --- | --- | --- | --- | --- | --- |
| `ticket.escalate` (new, F-7 block) | `support` | ✓ (computed) | **✓ workspace-wide (D-T7)** — not in the `WORKSPACE_ADMIN_PERMISSIONS` exclusion | ✗ | Tier 1/2/3 Agent: **team-scoped** to their tier team (D-T4). T3 needs it too, for de-escalation (D-T8). | `escalateTicketFn` → `assertCanEscalate` (`canInTeam` + roll-up) |
| `team.manage` (existing) | | ✓ | ✗ | ✗ | ✗ | Tiers settings functions |
| `ticket.view` / `ticket.assign` / `analytics.view` (existing) | | | | | | fn gate / override target / report |
| — (bare `requireAuth()`, END_USER) | | | | | | Hub functions: requester-only, own items (§4.11) |

- **Gate shape (OI-2 resolved by 10 §4.4).** Team-scoped rows are invisible to upstream resolution, so `requireAuth({ permission:
  'ticket.escalate' })` would reject a tier agent. `escalateTicketFn` therefore gates on `requireAuth({ permission: ticket.view })`,
  and `assertCanEscalate` performs the real check with `canInTeam` (workspace-wide OR team-scoped). The matrix records the
  `ticket.view` gate.
- **Tier role bundles (final for escalation; 10 seeds them).** Each Tier N Agent is a workspace-level custom role
  (`conversation.view/reply/note/set_status`, `ticket.view/reply/note/set_status`; T2+ adds `ticket.assign`, `conversation.assign`;
  T3 adds `*.view_all`) **plus** a team-scoped grant of `ticket.escalate` on the agent's tier team. The team-scoped grant is what
  makes D-T8 work.
- End users never see tier, reason, or ledger data. Portal, hub and widget show only the public `stage`.

## 7. Seams

**Core (Phases 1–5): 2 own seams.**

| # | Upstream file | Change (one-liner) | Why | Re-apply on conflict |
| --- | --- | --- | --- | --- |
| T-1 | `apps/web/src/lib/server/policy/tickets.ts` (1 commit / 90 d) | `OR ${forkEscalatedByMeFilter(principalId)}` in `ticketFilter` branch (3), plus an import | D-T6 (approved): visibility is a pure SQL predicate with no extension point | Re-add the OR term in branch (3). Test: `fork/tiered-support/__tests__/visibility.test.ts` |
| T-2 | `apps/web/src/components/admin/inbox/inbox-detail-panel.tsx` (25) | `<ForkTierPanel …/>` after the Watchers row, plus an import. Shared with 40's A-2 as one fork slot. | There is no slot in the detail panel | Place it after the `TicketWatchControl` row. The component self-hides. |

**Shared, not counted:** `ticket.escalate` in the F-7 block; the Tiers page through F-4; MCP tool (6c) through F-3; re-point
exemptions through F-5; migrations through F-1/F-2.

**Phase 7 hub (D-T11 B): 5 seams.**

| # | Upstream file | Change (one-liner) | Why | Re-apply |
| --- | --- | --- | --- | --- |
| T-3 | `apps/web/src/lib/server/policy/authz-matrix/classifications.ts` (48) | `...FORK_CLASSIFICATIONS` spread into the classifications record | Hub functions are bare `requireAuth()` (END_USER). The reconciliation test fails without entries. | Re-add the spread at the end of the record. The fork list lives in `lib/server/fork/authz/classifications.ts`. |
| T-4 | `apps/web/src/lib/server/auth/signup-policy.ts` (2) | `if (await forkIsKnownRequester(normalised)) return true` in `isAccountCreationAllowed` before the invite lookup | D-T12: an email-only requester has no user row, so closed sign-up would refuse them | Re-add before the invitation branch |
| T-5 | `apps/web/src/locales/*.json` (9 files, count as one) | Append `portal.forkHub.*` keys | Portal i18n coverage test | Re-append; take upstream's version first |
| T-6 | `apps/web/src/components/widget/widget-overview.tsx` (14) | `<ForkHubHomeSection …/>` after `<WidgetRecentTicketsCard/>` (`:368`) | B: widget Home section | Place it after the recent-tickets card. Watch the widget bundle budget. |
| T-7 | `apps/web/src/components/public/portal-header-nav.ts` (5) | "Help hub" item → `/hub` | Hub discoverability from the portal | Re-add to the item map/order |


**Later phases:**

| Phase | Seams |
| --- | --- |
| 6 `escalate` workflow action (up-only, D-T9) | About 15 sites, found by grepping `convert_to_ticket`: `action.executor.ts` (union `:266` + switch), `workflow.schemas.ts:166`, `workflow-actor-permissions.ts`, `workflow-graph.ts` (`:729,1043,1426,2426,2468,2892`), `workflow-builder/entities.tsx:45,101`, `canvas.tsx:115`, `flow-layout.ts:282`, `step-visuals.tsx:57`, `step-content.ts:105,165`, `inspector/action-editor.tsx:42,340`. Each is a one-case delegation. |
| 6b macro `escalate` | `schema/macros.ts:38-45` (an upstream schema file, so a conventions exception needs sign-off), `macro.actions.ts:41-53`, `macros-manager.tsx` |
| 6c MCP tool | None own (F-3) |
| 8 stage email | One target-registration line in `events/targets.ts` (38) |

Generated files are regenerated, never merged: `permissions.ts`, `MATRIX.md`, `policy/dep-graph/GRAPH.md`.

## 8. Phases and validation gates

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 0 prereqs | Foundations (F-1…F-7). 10-rbac Phase 1a + Phase 2 (`canInTeam`). `ticket.escalate` in the F-7 block (Manager ✓). | `canInTeam` is available; a Manager holds `ticket.escalate` after `seedSystemData`. |
| 1 Tier model | `fork_team_tiers` + migration; Tiers page (F-4); edge/cycle validation; `listTierMemberships` / `getEffectiveTier` / `resolveTeamForTier`; `assignTierAgent` / `removeTierAgent` + MCP tools; enable flag with the routing-off check | Configure T1→T2→T3. Enabling is refused while auto-routing is on. An agent on T1 and T3 teams has effective tier 3. Assign then remove leaves no grants, memberships or stray workspace roles, and the MCP path is audited as the human. Drift and journal tests are green. |
| 2 Escalation | Ledger; `escalateTicket` / `escalateTicketFn` / `assertCanEscalate`; reason attribute; `ForkTierPanel` (T-2); watcher + T-1; "Escalated by me" | Paired T1→T2: both sides move; agent distributed or cleared; each event fires once; ledger, note and attribute written; SLA unchanged; escalator can open the ticket until they unwatch. Convert-first works. CONFLICT and idempotency hold. **De-escalation:** a T2 or T3 agent may move a T2 ticket down; a T1 agent may not; a Manager may. `targetTier` resolves to the edge chain. |
| 3 T1 intake | Seeded disabled workflows (no branches) | A new chat or a handoff → T1 team + T1 SLA. No path lands a new item on T2/T3. |
| 4 Queues | Seeded per-tier views | T2 agents see exactly T2 items |
| 5 Reporting | Timeline + report | Reconciles with a fixture. A carried SLA breach is attributed to the tier at breach time. |
| 6 Automation | Up-only `escalate` action (+ macro, + MCP via F-3) → `escalateTicket` with `source='workflow'` | `sla.approaching_breach` → escalate is audited and the SLA carries. No action can move down. Seam count re-verified. |
| 7a Requester access | Hub layout outside `_portal`; passwordless sign-in; T-3, T-4; lead claim; hub functions | On a **private** portal with closed sign-up, an email-only requester signs in by link **and** by code, sees their prior emailed requests, can reply, and gets the wall on `/support`, `/hc` and boards. Another user's ticket id returns 404. A blocked requester cannot send. `emailVerified=true`. The drift-guard test passes. |
| 7b Hub landing | `/hub` chain (announcements → find an answer → still need help → track → rate) per the prototype; widget Home section (T-6); header link (T-7); T-5 locales | Walkthrough in the widget and portal as a granted user (all sections) and as an ungranted passwordless requester (no "Find an answer"; track, submit and rate work). Widget bundle budget and i18n coverage pass. |
| 8 Stage email | Requester email on non-close public stage crossings, with a link to `/hub/requests/$id` | An email for each crossing; none for the same stage or a null stage |

## 9. Testing strategy

- **Service (DB):** paired, ticket-only and convert-first cases; round_robin, balanced and manual teams; agent cleared; SLA
  byte-identical before and after; ledger, attribute, note and watcher written; idempotency; CONFLICT; `targetTier` resolution;
  `source='account_action'` recorded.
- **Authorization matrix:**
  - Manager ✓ in both directions.
  - Team-scoped holder on the from-team ✓, and on a higher tier ✓ (roll-up). On a lower tier ✗, including down (D-T8).
  - Override without `ticket.assign` ✗.
  - Workspace-wide holder without team membership ✓.
- **Effective tier:** no teams → null; soft-deleted team ignored; multiple teams → max.
- **Policy:** T-1 predicate (escalator + watching ✓; unwatched ✗; other watcher ✗; `view_all` path unchanged). Upstream
  `policy/__tests__` re-run.
- **Hub/auth:**
  - `forkIsKnownRequester`: a lead with activity ✓; a lead with none ✗; an address with a user row → unchanged path.
  - No-enumeration: identical response and email count for known, unknown and refused addresses.
  - Lead-claim idempotency.
  - Ownership 404s.
  - The private-portal wall still shows for `_portal` routes.
  - The drift-guard test.
- **Guardrails:** module-state scan, authz matrix and classifications reconciliation, dep-graph, fork drift/journal tests,
  single + pooled tenancy, widget bundle budget, portal i18n coverage.
- **GUI walkthrough:** configure tiers → a new chat lands in T1 → escalate → T2 queue → the escalator still sees the ticket →
  T2 de-escalates → report. Separately: a signed-out requester → `/hub` → code sign-in → sees and replies.

## 10. Open items

| ID | Item | Ref |
| --- | --- | --- |
| D-T8 🟡 | Confirm that de-escalation is done by the holding tier (with roll-up: higher tiers and Managers also may). | 01 Still open |
| OI-14 | Lead claim (§4.11 step 3): should unverified (weak-DMARC) email leads be merged into the verified address owner? Default: yes. The messages keep their unverified badge. The alternative is to claim only DMARC-pass leads. | new |
| OI-15 | On private portals, should passwordless requesters without a portal grant see "Find an answer" (KB search, Ask AI, collections) in the hub? That would need a read path around the `/hc` and Ask AI gates. Default: hidden for ungranted requesters. | new, D-N5 |

## 11. Relationship to other v2 plans

- **10-rbac:** provides `canInTeam`, team-scoped grants, `TEAM_SCOPABLE_PERMISSIONS` and the Tier role templates (workspace-wide
  dashboard keys + team-scoped `ticket.escalate` / `account.*`). It also provides `assignTierAgentFn`, which wraps §4.12. 10's
  current text agrees with this plan on the following, so there is nothing to reconcile:
  - Manager ✓ for `ticket.escalate` (D-T7);
  - T3 keeps `ticket.escalate` by roll-up, and 30 treats it as having no up target;
  - `account.execute` replaces `account.unlock` / `account.create`.
- **40-support-account-actions — contract:**
  - `escalateTicket(input, actor)` is a domain function with **no** permission check of its own. Callers authorize:
    `escalateTicketFn` → `assertCanEscalate`; 40's request flow → `account.request` (via `canInTeam` on the from-team).
  - Input includes `source: 'manual' | 'workflow' | 'mcp' | 'account_action'`, `reason` (40 passes `account_action`, with the
    request id in `note`), and **`targetTier`**. D-A11: 40 passes the action's `min_tier`, and the ticket moves along the edge
    chain to the first team at or above that tier.
  - Returns `{ escalationId, fromTeamId, toTeamId, direction }`. 40 stores `escalationId`.
  - D-T2 applies: the requester is cleared and made a watcher, so T-1 gives them read access while watching.
  - Also exported: `listTierMemberships(principalId)` → `[{teamId, tier}]`, plus `getEffectiveTier(principalId)` built on it,
    `getTeamTier(teamId)` and `resolveTeamForTier(minTier, fromTeamId?)`. For `account.execute`, 40 requires some membership with
    `tier ≥ min_tier` **and** `canInTeam(actor, 'account.execute', teamId)`.
  - This resolves 40's A-Q7 (`listTierMemberships` exported; §4.2 aligned with this contract). 40 can close it.
- **20-control-tower:**
  - `sync-members` assigns Tier bundles through 30's `assignTierAgent` / `removeTierAgent` (§4.12), via the fork MCP tools
    `fork_assign_tier_agent` / `fork_remove_tier_agent` (F-3, `member.manage`), acting as the human admin (D-C2). It passes the
    tier **team**. 20 must therefore map a Tier bundle to a specific tier team per app, not just to a template key (coordinator).
  - "Fleet Agent" should include `ticket.escalate` if tower agents escalate. That also goes through tenant MCP (F-3).
- **60-announcements:** T-5 (locales) and N-2 edit the same 9 files. Co-locate both key blocks.
- **Shared-seam candidate:** T-3 (`classifications.ts` spread) will be needed by any plan with bare `requireAuth()` gates.
  Propose it as foundation seam **F-8**.
- **Possible finding (unverified, outside this plan):** upstream `/api/widget/kb-ask` checks only the `helpCenter` flag and
  `audience: 'public'` article gating. It does not call `resolvePortalAccessForRequest` (`kb-ask.ts:143,208-210`). Before relying
  on private portals (D-N5) to protect KB content, confirm whether help-center audience rules cover this case.
- **SEAMS.md updates needed (coordinator):**
  - T-1: drop "needs security sign-off, OI-10".
  - Add T-3…T-7 (hub, D-T12 / D-T11 B).
  - Drop the channels reference.
  - Tiered-support core total stays at 2.
