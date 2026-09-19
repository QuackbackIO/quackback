# Tiered Support (Tier 1/2/3) + Unified Support Hub — Design Plan

> **Status:** Proposal / planning only. Nothing here is implemented.
> **Goal:** Extend support beyond live chat into a proper **tiered helpdesk** (T1/T2/T3) for the
> **customer-success team**, and make it a **one-stop shop** for **end users** (self-serve → submit →
> chat → track → CSAT in one place). Build by **extending** the substantial support platform that
> already exists, not rebuilding it.

## 0. Key context — most of the helpdesk already exists

Quackback already has a mature support platform. This plan is largely **assembly + a thin tier layer**:

- **Converged conversations + tickets**: a `conversation` (thread/inbox row) and a `ticket` (tracked
  work: status registry, SLA, `#number`, activity log) are peers; a **customer ticket ↔ conversation is
  1:1** with a shared thread (`ticket_conversations`, `packages/db/src/schema/tickets.ts`).
- **Teams + assignment**: `teams` with `assignment_method` `manual | round_robin | balanced`
  (`schema/teams.ts`, `domains/conversation/routing/team-distribution.ts`); conversation/ticket
  assignee is polymorphic (team OR agent).
- **Workspace routing**: `domains/conversation/routing/*` with a strategy registry (today
  `auto_assign_active` = least-loaded online agent).
- **SLA + office hours**: `sla_policies` (first-response/next-response/time-to-close/time-to-resolve,
  pause-on-snooze/pending, office-hours schedule), `sla_events`, sweeps (`domains/sla/*`,
  `schema/sla.ts`, `office-hours.ts`).
- **Workflow engine + macros**: `domains/workflows/action.executor.ts` (actions: `assign_agent`,
  `assign_team`, `apply_sla`, `set_ticket_status`, `add_note`, `convert_to_ticket`, `record_csat`, …;
  triggers: `assistant.handed_off`, `conversation.*`, `ticket.status_changed`, SLA timers), macros
  (`schema/macros.ts`).
- **Unified inbox + saved views**: `domains/inbox/inbox.query.ts`, `conversation-views` (rule fields
  include **`team`**, status, priority, assignee, tags, attributes).
- **Collaboration**: internal notes (`is_internal`), `@mentions`, cross-post notes, tracker tickets.
- **AI escalation to humans**: assistant `escalateToHuman()` → `assistant_involvements.handed_off`,
  `ASSISTANT_ESCALATION_REASON_KEY` attribute, internal handoff note (`domains/assistant/*`).
- **Multi-channel**: `messenger`, `email`, `github` via a **plug-in channel model** (descriptor +
  adapter registries; `domains/channels/*`, `lib/shared/channels/*`; adding a channel is documented in
  `channels/__tests__/extensibility.test.ts`).
- **Self-serve / deflection**: help center + hybrid KB search + Ask AI (`domains/help-center/*`,
  `/api/widget/kb-search`, `/api/widget/kb-ask`).
- **End-user surfaces**: widget tabs (home/messages/tickets/help/feedback/changelog), portal `/support`
  - `/hc`, email + GitHub threads, CSAT (`routes/csat.tsx`).

**Note:** there is already a ticket status labeled **"Escalated"** (`DEFAULT_TICKET_STATUSES`), but it's a
cosmetic status, **not** a routing tier. And the "three-tier people model" in code refers to
visitor/user/customer _people_, not support tiers.

## 1. Requirements

| #   | Requirement                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------- |
| R1  | First-class **Tier 1/2/3** model for the CS team (queues, ownership, escalation).                           |
| R2  | **Escalate / de-escalate** a conversation or ticket between tiers, preserving context, with an audit trail. |
| R3  | **Tier-aware routing** (initial contact → T1; escalate up; optional skill/type-based routing).              |
| R4  | **Per-tier SLAs** and tier-scoped inbox queues + reporting.                                                 |
| R5  | **One-stop shop for end users**: self-serve → submit → chat → track → CSAT in one hub, across channels.     |
| R6  | Reuse existing platform; keep changes additive; multi-tenant-safe (single + pooled).                        |

## 2. TL;DR recommendation

Two thrusts, both extensions of existing systems:

**A. Tier layer for agents** — model **tiers as an attribute of `teams`** (T1/T2/T3), because teams are
already the assignable unit with routing/distribution. Add:

- `teams.tier` + `teams.escalates_to_team_id` + optional `teams.default_sla_policy_id`.
- An **`escalate` primitive** (manual action + workflow/macro action) that reassigns to the next tier's
  team, records an **escalation event** (new `support_escalations` table, polymorphic over
  conversation/ticket like `sla_events`), captures a reason, drops an internal handoff note, and applies
  the target tier's SLA — reusing the existing action executor and SLA engine.
- **Tier-aware routing strategy** in the existing routing registry; **tier queues** as saved views
  filtered by team/tier; **tier reporting** in analytics.

**B. Unified end-user support hub** — a single surface (portal `/support` landing + widget Home) that
chains **self-serve (KB/Ask AI) → "still need help?" → submit request / start chat → track tickets &
status → CSAT**, and makes **ticket submission first-class** (reuse `ticket-intake.service.ts` /
`createMyTicket` outside workflow blocks). Optionally expand channels (Slack/SMS/WhatsApp) via the
existing channel plug-in pattern.

## 3. Current-state gap analysis

| Capability        | Exists today                                                 | Gap for tiered helpdesk                                                                    |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Assignable groups | `teams` + assignment methods                                 | No `tier`/`escalates_to` on teams                                                          |
| Escalation        | AI→human handoff; manual reassign; "Escalated" ticket status | No tier escalate primitive, no reason-tracked **human→human** escalation, no audit/metrics |
| Routing           | least-loaded online / team RR / balanced                     | No tier/skill-based routing; initial contact not tier-aware                                |
| SLA               | generic policies, attach via workflow/link                   | No per-tier default policy selection                                                       |
| Queues/views      | saved views incl. `team` rule                                | No explicit tier filter or tier dashboards                                                 |
| Reporting         | CSAT, Quinn performance, SLA                                 | No time-in-tier / escalation-rate / per-tier SLA metrics                                   |
| End-user hub      | widget tabs, portal `/support` + `/hc`, email, github        | Fragmented; ticket submit only via workflow block; no unified self-serve→submit→track flow |
| Channels          | messenger, email, github (plug-in model)                     | No SMS/Slack/WhatsApp/social (optional)                                                    |

## 4. Design — A. Tier layer for the CS team

### 4.1 Tier model (teams-as-tiers)

Additive columns on `teams` (`schema/teams.ts`):

- `tier` — `smallint` / enum (`1|2|3`, extensible), nullable (a team may be non-tiered).
- `escalates_to_team_id` — FK to `teams` (the default next tier for one-click escalate).
- `default_sla_policy_id` — FK to `sla_policies` (the tier's SLA), nullable.

Rationale: teams already carry membership + distribution (`round_robin`/`balanced`) and are the assignee
unit on both conversations and tickets — so a "tier" is just a typed team with an escalation edge and a
default SLA. No new assignee concept needed.

### 4.2 Escalation primitive (+ audit)

New `support_escalations` table (polymorphic subject, mirroring `sla_events`):

| Column                               | Notes                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `id` (`esc_…`)                       | PK                                                                        |
| `conversation_id` **or** `ticket_id` | XOR subject                                                               |
| `from_team_id`, `from_tier`          | Originating tier (nullable for first escalation from unassigned/AI)       |
| `to_team_id`, `to_tier`              | Target tier                                                               |
| `direction`                          | `up` \| `down`                                                            |
| `reason`                             | enum/text (reuse the assistant handoff reason vocabulary + human reasons) |
| `note`                               | optional context                                                          |
| `by_principal_id`                    | who escalated (null = automated/workflow)                                 |
| `created_at`                         | for time-in-tier / escalation-rate metrics                                |

Also track **originating vs current tier** on the subject for quick queries: add
`conversations.origin_tier` / `tickets.origin_tier` (or derive from the first escalation row). Current
tier = the assigned team's `tier`.

**Escalate action** (one implementation, three entry points):

- A domain service `escalateSubject({ subject, toTeamId?, direction, reason, note }, actor)` that:
  reassigns `assigned_team_id` (and clears/keeps agent per rule), runs the team's distribution
  (round-robin/balanced), writes `support_escalations`, appends an **internal handoff note** (reuse
  `addAgentNote` / the assistant handoff-note pattern), sets an `escalation_reason` conversation
  attribute (reuse `conversation_attribute_definitions` like `ASSISTANT_ESCALATION_REASON_KEY`), emits a
  **system event** (`escalated`) + a domain event, and **applies the target tier's SLA** via the existing
  `applySlaToConversation` / `applySlaToTicket`.
- **Manual**: an "Escalate ▸ Tier N" button in the agent conversation/ticket header (defaulting to
  `escalates_to_team_id`, with an override picker + reason).
- **Workflow/macro action**: add `escalate` to `domains/workflows/action.executor.ts` (and macro
  `MacroAction`) so escalation can be automated (e.g., on SLA-approaching, on keyword, on AI handoff, on
  ticket status → a tier).

### 4.3 Tier-aware routing

- Extend the routing strategy registry (`domains/conversation/routing/routing.registry.ts`) with a
  **`tier`/`skills` strategy**: initial contact and AI handoff route to the **T1 team** by default;
  optionally classify by ticket type / conversation attributes / keywords to route directly to a higher
  tier or a specialized team. Reuse the existing conversation-attributes **AI classification** to
  auto-route where configured.
- Escalation moves ownership up the `escalates_to_team_id` chain; de-escalation moves it down.

### 4.4 Per-tier SLAs

- When a subject lands in a tier team, apply that team's `default_sla_policy_id` (via the escalate
  service and the workspace routing/link path). Reuse the existing SLA engine, sweeps, and office hours
  wholesale — this is policy **selection**, not new SLA math.

### 4.5 Tier queues, views, reporting

- **Queues**: tier queues are **saved views** filtered by team (the `team` rule already exists in
  `conversation-views`); add an explicit **`tier`** view rule + inbox filter for convenience, and seed a
  view per tier.
- **Reporting**: extend analytics with **time-in-tier**, **escalation rate**, **per-tier SLA
  attainment**, and **CSAT-by-tier** (join `support_escalations` + `sla_events` + CSAT). Surface a Tiers
  dashboard in admin.

### 4.6 Agent UX

- Conversation/ticket header: current-tier badge, **Escalate/De-escalate** control (target + reason),
  tier SLA timer, and the escalation history (from `support_escalations`).
- Inbox: tier queues in the nav scopes (`lib/client/conversation/inbox-scope.ts`), a tier column/filter.
- Settings: a **Teams & Tiers** admin page (assign tier, escalation edge, default SLA, members,
  distribution method) extending the existing teams settings.

## 5. Design — B. Unified end-user support hub

### 5.1 One-stop hub (portal + widget)

A single support entry point that chains the funnel instead of scattering it across tabs:

1. **Self-serve first** — KB search + Ask AI (`kb-search` / `kb-ask`) at the top.
2. **"Still need help?"** → **Start a chat** (messenger) or **Submit a request** (ticket form).
3. **Track** — my open conversations/tickets with **stage chips** (reuse `getMyConversationsFn`,
   `requester.service.ts::listMyTicketSummaries`, `ticket-stage` badges).
4. **CSAT** — post-resolution, channel-aware (reuse existing CSAT surfaces).

Implement as: a portal `/support` **landing** that composes existing pieces (help search + Ask AI +
"my requests" list + new-request CTA), and a widget **Home** that mirrors it. Reuse
`visitor-conversation-thread.tsx` for the thread.

### 5.2 First-class ticket submission

Today `createMyTicket` (`ticket-intake.service.ts`) is reachable only via a workflow `ticketForm` block.
Expose a **"Contact us / New request" form** directly in the widget Tickets tab and the portal hub
(category/type picker → `ticket_types`, fields → ticket `custom_attributes`), reusing the intake service
and the converged conversation-backed ticket.

### 5.3 Cross-channel consistency

- Email- and GitHub-origin threads should be **viewable/trackable** in the hub (at least status +
  history), so a signed-in user has one place regardless of how they contacted support.
- Keep channel-appropriate reply transport (the adapter layer already handles delivery per channel).

### 5.4 Proactive status notifications

- Add a requester notification on **ticket stage transitions** (email/in-app), reusing the events →
  notification pipeline (currently stage changes are in-app badges only) so end users are kept informed
  without opening the app.

### 5.5 Optional: more channels

Add SMS / Slack Connect / WhatsApp / social via the documented **channel plug-in** pattern
(`CHANNELS` enum + descriptor + adapter + inbound route + settings page). No core `channel ===` branching
needed when registered correctly (proven by `channels/__tests__/extensibility.test.ts`).

## 6. Data model changes (additive)

- `teams`: `tier`, `escalates_to_team_id`, `default_sla_policy_id`.
- New `support_escalations` (polymorphic conversation/ticket; §4.2).
- `conversations` / `tickets`: `origin_tier` (nullable) for fast metrics (optional; derivable).
- New conversation attribute definition `escalation_reason` (seeded like `ASSISTANT_ESCALATION_REASON_KEY`).
- New saved-view rule + inbox filter `tier`.
- (End-user) no new core tables required — reuse tickets/conversations/help-center.

All ship via the standard migrator and the fleet migrator (`apps/web/scripts/fleet-migrator.ts`).

## 7. Backend seams to extend (reuse, don't rewrite)

- Routing: `domains/conversation/routing/routing.registry.ts` (+ a new `tier`/`skills` strategy), and
  `routeUnassignedConversation` / assistant handoff assignment.
- Distribution: `domains/conversation/routing/team-distribution.ts` (already RR/balanced).
- Escalation service (new) `domains/support/escalation.service.ts` using existing assign + SLA + notes.
- Workflow/macro action `escalate`: `domains/workflows/action.executor.ts`, `schema/macros.ts` (`MacroAction`).
- SLA selection by team tier: `domains/sla/sla.service.ts` / `ticket-sla.service.ts` + link path.
- Inbox/views: `domains/inbox/inbox.query.ts`, `conversation-views` + `lib/shared/conversation/views.ts`.
- End-user intake: `domains/tickets/ticket-intake.service.ts`, `requester.service.ts`, `functions/tickets.ts`, widget/portal support surfaces.
- Notifications: `domains/conversation/conversation.notify.ts` + events pipeline for stage changes.

## 8. Permissions

- Reuse team/conversation/ticket management permissions for assign/escalate; add a specific
  `support.escalate` capability if finer control is wanted (mirror the existing permission catalogue in
  `lib/shared/permissions.ts` / `rbac-catalogue.ts`). Tier configuration gated by settings-management.
- End-user surfaces stay visitor-scoped; escalation/tier data is **staff-only** (never on portal/widget
  requester views beyond the existing public `stage`).

## 9. Multi-tenant & upgrade-safety

- **Multi-tenant:** everything is per-workspace (teams, SLA, routing config, views) and ships via the
  fleet migrator; nothing tenancy-specific. Composes with the control-tower plan
  (`plans/v1/multi-tenant-control-tower-plan.md`) — a fleet admin could view tiered support across apps.
- **Upgrade-safety:** almost entirely **additive** — new columns on `teams`, a new `support_escalations`
  table, a new escalation service, a new routing strategy, a new workflow/macro action, a new view rule,
  new analytics, and new/re-composed UI surfaces. Localized edits to shared enums (view rules, macro
  actions, inbox scopes). Because these extend documented plug-in points (routing registry, action
  executor, channel registry, view rules), they're strong **upstream-contribution** candidates rather
  than a divergent fork.

## 10. Phased plan (with validation)

| Phase                                 | Deliverable                                                                                                            | Validation                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **1. Tier model**                     | `teams.tier` / `escalates_to_team_id` / `default_sla_policy_id`; Teams & Tiers admin page                              | Configure T1→T2→T3 chain + per-tier SLA                                               |
| **2. Escalation primitive + audit**   | `support_escalations`; `escalateSubject()`; system event + handoff note + reason attribute; manual Escalate control    | Escalate a conversation T1→T2: reassigns, records event, applies T2 SLA, notes reason |
| **3. Tier-aware routing**             | `tier`/skills routing strategy; T1 default for new contact + AI handoff; optional attribute/type routing               | New chat lands in T1; classified request routes to correct tier                       |
| **4. Workflow/macro `escalate`**      | `escalate` action in executor + macros; triggers (SLA-approaching, keyword, status)                                    | Auto-escalate on SLA breach-approaching fires and is audited                          |
| **5. Tier queues + reporting**        | `tier` view rule + inbox filter; seeded tier views; Tiers dashboard (time-in-tier, escalation rate, per-tier SLA/CSAT) | Agents see per-tier queues; dashboard numbers reconcile with events                   |
| **6. Unified support hub**            | Portal `/support` landing + widget Home funnel (KB/Ask AI → submit/chat → track → CSAT); first-class ticket submit     | End user self-serves, submits a request, chats, and tracks status in one place        |
| **7. Proactive status notifications** | Requester email/in-app on ticket stage transitions                                                                     | Stage change notifies the requester                                                   |
| **8. (Optional) New channels**        | Add a channel (e.g. Slack/SMS) via plug-in pattern                                                                     | Inbound lands in inbox; agent reply delivered on-channel                              |

## 11. Validation & testing strategy

- **Escalation:** unit/db tests for `escalateSubject` (reassign, SLA swap, audit row, note, attribute);
  round-robin/balanced distribution within the target tier.
- **Routing:** deterministic tests for tier strategy (new contact → T1; classified → tier N).
- **SLA-by-tier:** verify the target tier's policy attaches and breach sweeps behave.
- **Reporting:** reconcile time-in-tier / escalation-rate against seeded `support_escalations`.
- **End-user hub (GUI):** self-serve → submit → chat → track → CSAT recorded as a walkthrough (widget +
  portal), plus regression that existing inbox/SLA/CSAT flows are unaffected.

## 12. Open questions

1. **Tiers on teams vs a separate tier object?** (Recommended: on teams. Confirm you don't need multiple
   teams sharing one tier with independent escalation edges — if so, a small `support_tiers` table.)
2. **Escalation reassigns the agent, or team-only?** (Default: move to the tier team + run distribution;
   keep or clear the prior agent?)
3. **De-escalation** allowed, and who can? Auto de-escalate on "waiting on customer"?
4. **Skills/attribute routing** in v1, or start with straight T1→T2→T3 manual/auto escalation?
5. **End-user hub scope** — replace the current split (portal `/support` + `/hc`, widget tabs) with one
   hub, or add a hub landing that links them?
6. **Anonymous/email-only users** — do they get the in-app hub (requires sign-in today) or stay
   email-tracked?
7. **Which extra channels** (if any) are priorities: Slack, SMS, WhatsApp, social?
8. **Tier SLAs** — distinct policy per tier, or one policy with per-tier targets?

## 13. File / seam index

Reuse (existing):

- Teams/assignment: `schema/teams.ts`, `domains/teams/team.service.ts`, `domains/conversation/routing/team-distribution.ts`
- Routing: `domains/conversation/routing/routing.registry.ts`, `routing.service.ts`, `strategies/auto-assign-active.ts`, `settings.conversation-routing`
- Conversations/tickets: `schema/conversation.ts`, `schema/tickets.ts`, `domains/conversation/*`, `domains/tickets/*` (`ticket.service.ts`, `ticket-conversation-link.service.ts`, `ticket-intake.service.ts`, `requester.service.ts`)
- SLA/office hours: `schema/sla.ts`, `office-hours.ts`, `domains/sla/*`
- Workflows/macros: `domains/workflows/action.executor.ts`, `event-trigger.ts`, `schema/macros.ts`, `domains/macros/*`
- Inbox/views: `domains/inbox/inbox.query.ts`, `schema/conversation-views.ts`, `lib/shared/conversation/views.ts`, `lib/client/conversation/inbox-scope.ts`
- Collaboration: internal notes/mentions (`conversation.service.ts`, `conversation_message_mentions`), tracker links (`ticket_links`)
- Assistant escalation: `domains/assistant/assistant.orchestrator.ts`, `assistant.involvement.ts`, `conversation-attributes/conversation-attribute.service.ts` (`ASSISTANT_ESCALATION_REASON_KEY`)
- Channels: `lib/shared/channels/*`, `domains/channels/*`, `channels/__tests__/extensibility.test.ts`, admin `settings.channels_*.tsx`
- End-user: `routes/_portal/support.*`, widget `components/widget/*`, help center `domains/help-center/*` + `/api/widget/kb-*`, CSAT `routes/csat.tsx`, `conversation.notify.ts`
- Permissions: `lib/shared/permissions.ts`, `packages/db/src/rbac-catalogue.ts`

New (to build, additive):

- `teams` columns: `tier`, `escalates_to_team_id`, `default_sla_policy_id`
- `support_escalations` table (+ optional `origin_tier` on conversations/tickets)
- `domains/support/escalation.service.ts`
- `tier`/skills routing strategy in the routing registry
- `escalate` workflow + macro action
- `tier` saved-view rule + inbox filter + seeded tier views
- Tiers dashboard + Teams & Tiers admin page
- Unified support hub (portal `/support` landing + widget Home) + first-class ticket-submit form
- Requester stage-change notifications

## 14. Relationship to other plans

- Composes with the **multi-app control tower** (`plans/v1/multi-tenant-control-tower-plan.md`): tiered
  support is per-app, and the Tier-B console can aggregate support/tiers across apps.
- Independent of the announcements and prioritization plans, though a status/announcements banner and
  RICE scoring both complement a support+product workflow.
