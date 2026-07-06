# UNIFIED-INBOX-SPEC.md

Merge the admin Conversations page (`/admin/inbox`) and Tickets page (`/admin/tickets`) into one
unified Support inbox, Featurebase-style: one list, one thread, one details panel, one Copilot.
A ticket is an attribute of an inbox item, not a separate surface.

- Status: implemented (M1-M6 landed on next, 2026-07-06)
- Mockup (interactive, canonical for layout decisions): https://claude.ai/code/artifact/f42c1f4c-505b-4658-8aa1-b3f222522660
- Codebase state audited: branch `next` @ working tree 2026-07-06 (post `5b212ab22` composer unification)
- Related: SUPPORT-PLATFORM-SPEC.md (§4.2 tickets, §4.6 inbox depth), TICKET-CONTENT-PARITY-SPEC.md (content layer, Phase 2 editor unification already shipped)

---

## 0. Goals and non-goals

**Goals**

1. One admin surface for conversations and tickets: single route, nav, list, thread, details panel, Copilot.
2. Tickets inherit the inbox shell for free: SSE live updates, search, bulk actions, keyboard layer,
   command bar, saved views, unread badges.
3. The admin thread adopts the chat-bubble visual style already shared by the widget and portal
   (`VisitorMessageBubble` tokens), replacing the current flat inbox-row rendering.
4. Full cleanup: the standalone tickets UI is deleted, not orphaned. ~2,200 lines of near-duplicate
   shell code removed.
5. Admin sidebar collapses Conversations + Tickets into one **Support** entry.

**Non-goals (explicitly out of scope)**

- Portal/requester surfaces (`_portal/support.*`, `portal-tickets-list`) stay as they are.
- Settings UIs (ticket types, ticket statuses & stages, conversation data) stay as they are.
- REST API (`/api/v1/tickets/*`, read-only) and MCP ticket tools stay as they are.
- No changes to the ticket data model semantics (types, two-axis status, links, cascade).
- Ticket tags: deferred. There is no `ticket_tags` concept today; the unified panel simply hides the
  Tags row for ticket items. Do not invent one in this project.
- Macro actions on tickets: deferred. Macros stay conversation-scoped (capability-gated off for
  ticket items).
- AND/OR rule trees in saved views: out of scope, the flat AND rule list is extended, not redesigned.

---

## 1. Current state (audited inventory)

### 1.1 What is already shared (do not rebuild)

| Layer       | Fact                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messages    | `conversation_messages` is polymorphic: `conversation_id` XOR `ticket_id`, CHECK `num_nonnulls(...) = 1`, per-parent keyset indexes exist (`_conversation_created_idx`, `_ticket_created_idx`). Reactions/mentions/flags/translations hang off it.               |
| DTOs        | `ConversationMessageDTO` and `FlaggedMessageDTO` already carry `conversationId \| ticketId` (exactly one set).                                                                                                                                                   |
| Thread core | `ThreadViewport` / `useThreadVirtualizer` / `useOlderMessages` (`components/conversation/thread.tsx`, 247 L) used by both threads.                                                                                                                               |
| Bubbles     | `AgentMessageBubble` (with `readOnly` prop) used by both; `VisitorMessageBubble` (same file) is the canonical chat bubble used by widget + portal.                                                                                                               |
| Composer    | Both threads use `RichTextEditor` + `CONVERSATION_EDITOR_FEATURES` / `CONVERSATION_NOTE_FEATURES` + `ComposerAttachmentTray`. The hand-rolled composers are gone (retired in `5b212ab22`, zero imports remain).                                                  |
| Menus       | `PriorityDot` / `PriorityMenuItems` / `AssigneeMenuItems` / `useInboxTeams` reused by ticket controls already.                                                                                                                                                   |
| Panel misc  | `ExportTranscriptButton` (pure `load()` callback) and `CompanyCard` (principal-scoped) are already item-agnostic. `use-copilot-insert.ts` has zero id coupling.                                                                                                  |
| Attributes  | Domain writer `set-attribute.service.ts` already accepts `SetAttributeTarget = { conversationId } \| { ticketId }`; the attribute registry schema comment says it serves "conversations AND tickets". Only the server fn + React editor are conversation-locked. |
| Transforms  | `runCopilotTransform` takes `text` + `principalId`, no item id. The copilot SSE contract payloads have no id coupling.                                                                                                                                           |

### 1.2 The duplicated shell (what this project deletes)

| File                                               | Lines | Duplicates                                                                                           |
| -------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `routes/admin/tickets.tsx`                         | 183   | route shell vs `inbox.tsx` (1041)                                                                    |
| `components/admin/tickets/ticket-list-column.tsx`  | 282   | list column vs `conversation-list-column.tsx` (375)                                                  |
| `components/admin/tickets/ticket-thread.tsx`       | 374   | thread container vs `agent-conversation-thread.tsx` (1173); copy-pasted ComposerDraft/tab/send logic |
| `components/admin/tickets/ticket-detail.tsx`       | 82    | detail shell                                                                                         |
| `components/admin/tickets/ticket-detail-panel.tsx` | 143   | details panel vs `conversation-detail-panel.tsx` (492)                                               |
| `components/admin/tickets/new-ticket-dialog.tsx`   | 212   | compose dialog vs `new-conversation-dialog.tsx` (181)                                                |
| `lib/client/queries/tickets.ts`                    | 104   | query factory vs `conversation-inbox.ts`                                                             |
| `lib/client/mutations/tickets.ts`                  | 74    | mutation hooks                                                                                       |

Kept and ported (ticket-only concepts, no conversation analogue): `ticket-chips.tsx` (100 L,
presentational), `ticket-controls.tsx` (213 L, thin wrappers over shared menus), `ticket-links.tsx`
(174 L, tracker links UI).

### 1.3 The real gaps (what this project builds)

1. **No unified list.** Tickets have no keyset cursor at all (`LIMIT`-only), no `(updatedAt, id)` /
   `(createdAt, id)` composite indexes, no `search` in `TicketListFilter` (FTS exists separately in
   `ticket-search.service.ts`).
2. **No ticket SSE.** Zero `publish()` calls in the tickets domain; no `ticket:*` channels; no ticket
   branch in `routes/api/chat/stream.ts`. Tickets poll every 30s.
3. **No ticket unread.** `tickets` has no last-read columns (conversations have
   `visitorLastReadAt`/`agentLastReadAt`).
4. **No nav-badge counts** for either aggregate (only Quinn buckets exist).
5. **RBAC list-scoping divergence.** `listTickets` applies `ticketFilter(actor)`;
   `listConversationsForAgent` never applies `conversationFilter(actor)` (documented as an unwired
   seam), so any `conversation.view` holder sees every conversation. The unified endpoint fixes this.
6. **Copilot / pending actions are conversation-hard-wired** at exactly these points: both route
   request schemas, `gateCopilotRequest`'s generic bound `T extends { conversationId: string }`,
   `assistant_pending_actions.conversationId NOT NULL` (no ticket column),
   `AssistantToolContext.conversationId` (no ticketId field), `summarizeConversationNowFn`.
7. **Admin thread visual style** is a flat row (`rounded-md`, no alignment, no fill), not the
   chat-bubble style of the mockup/widget.

### 1.4 RBAC keys in play (catalogue currently has 86 keys)

- Conversations: `conversation.view`, `view_all`, `reply`, `note`, `assign`, `manage`, `set_status`,
  `set_tags`, `manage_tags`, `manage_views`, `set_attributes`.
- Tickets: `ticket.view`, `view_all`, `reply`, `note`, `assign`, `set_status`, `create`,
  `manage_types`.
- Row scoping predicates: `policy/conversations.ts::conversationFilter`,
  `policy/tickets.ts::ticketFilter` (service → all; `view_all` → all; `view` → assigned to me or my
  team; else none).

---

## 2. Target design

### 2.1 Item model

```ts
// lib/shared/inbox/item.ts (new)
type InboxItemRef = { kind: 'conversation'; id: ConversationId } | { kind: 'ticket'; id: TicketId }

type InboxItemDTO =
  | { kind: 'conversation'; conversation: ConversationDTO }
  | { kind: 'ticket'; ticket: TicketDTO; linkedConversationId: ConversationId | null }
```

**One-row rule.** A conversation with a linked customer ticket renders as ONE row: the conversation
row wearing the ticket chip (`#N` + status). The customer ticket's own row is suppressed whenever a
`ticket_conversations` link to it exists (the partial unique index guarantees at most one customer
ticket per conversation). Back-office, tracker, and unlinked customer tickets are rows of their own.
Implemented in SQL: the ticket branch of the union excludes
`type = 'customer' AND EXISTS (SELECT 1 FROM ticket_conversations tc WHERE tc.ticket_id = tickets.id)`.

**Triage facet** (list chips, replaces the conversation status chips):

| Chip    | Conversation         | Ticket (status category) |
| ------- | -------------------- | ------------------------ |
| Open    | `status = 'open'`    | `category = 'open'`      |
| Waiting | `status = 'snoozed'` | `category = 'pending'`   |
| Closed  | `status = 'closed'`  | `category = 'closed'`    |
| All     | all                  | all                      |

The full customizable ticket status (`ticket_statuses` row, category × publicStage) remains a
per-item control in the thread header and details panel; the facet only reads the category axis.

### 2.2 URL contract

- Route stays `/admin/inbox`. New selection param `i` holding a TypeID (`conversation_…` or
  `ticket_…`); the prefix discriminates the kind.
- Legacy `c` param is accepted forever: `validateSearch` normalizes `c=X` → `i=X` (existing deep
  links in notification emails, `conversation.convert.ts`, `conversation.notify.ts` keep working;
  those emitters switch to `i=` in the cleanup phase).
- `m` (message deep link) unchanged; valid for either parent since flags are polymorphic already.
- `/admin/tickets` becomes a redirect route: `/admin/tickets?t=X` → `/admin/inbox?i=X`, bare
  `/admin/tickets` → `/admin/inbox?view=tickets_customer` (see 2.3). Keep the redirect file
  permanently (it is 15 lines).
- New scope params: existing `view|tag|segment|team|viewId` gain ticket scopes via `view` values
  (below). Existing `status` param becomes the triage facet (`open|waiting|closed|all`); accept
  legacy `snoozed` as `waiting`.

### 2.3 Navigation

Admin sidebar (`admin-sidebar.tsx`): replace the two entries with one
`{ label: 'Support', href: '/admin/inbox', icon: ChatBubbleLeftRightIcon }`, shown when
`supportInbox` is enabled. (If `supportTickets` is on but `supportInbox` off, show Support too; the
shell renders with conversation affordances hidden. This corner is unlikely; do not build a separate
mode for it beyond the flag gates below.)

Inbox nav sidebar (`inbox-nav-sidebar.tsx`) sections, in order:

1. Existing scopes: My inbox, Unassigned, All, Mentions, Saved for later. `mentions`/`saved` remain
   conversation-only by definition (mentions and flags are message-level and already polymorphic,
   so ticket notes with mentions appear under Mentions for free; verify, do not block on it).
2. **Tickets** section (visible when `supportTickets`): scopes `tickets_customer`,
   `tickets_back_office`, `tickets_tracker` (extend `InboxView`), filtering the unified list to
   `kind = 'ticket' AND type = …` plus linked-customer rows for the customer scope.
3. Quinn AI (unchanged, conversation-only).
4. Views (extended rule schema, see 2.8), Teams, Tags, Segments (unchanged; tags/segments remain
   conversation-scoped filters and simply exclude ticket rows when active).

### 2.4 List column

`conversation-list-column.tsx` becomes `inbox-list-column.tsx` rendering `InboxItemDTO[]`:

- Conversation rows: unchanged (avatar, `PriorityDot`, name, time, preview, `SlaChip`,
  `ChannelBadge`, `TagChip`, unread pill), plus a ticket chip `#N · <status name>` when
  `linkedCustomerTicket` is present on the DTO (add that summary field to `ConversationDTO`
  enrichment: `{ id, number, statusName, statusCategory }`).
- Ticket rows: square glyph avatar (type icon), title, `#N · type/status` chip, preview =
  `lastMessagePreview` (add to `TicketDTO` via the same batched enrichment used for conversations)
  or "No messages yet", assignee glyph, unread pill (once M2 lands).
- Multi-select checkboxes work on both kinds (selection becomes `Set<string>` of TypeIDs; kind
  recovered from prefix).
- Search box queries the unified endpoint (see 3.1); ticket `#N` inputs fast-path to a number match.

### 2.5 Thread: one container + capability object

`agent-conversation-thread.tsx` is generalized; `ticket-thread.tsx` is deleted. The component takes
an `item: InboxItemRef` plus an **adapter** and a **capability object**:

```ts
interface ThreadAdapter {
  threadQuery: (id) => QueryOptions      // conversationInboxQueries.thread | inboxQueries.ticketThread
  sendReply: (id, draft) => Promise<…>   // sendAgentMessageFn | sendTicketMessageFn
  sendNote: (id, draft) => Promise<…>    // addAgentNoteFn | addTicketNoteFn
  loadOlder: …                           // shared useOlderMessages, parameterized by query key + fetcher
}

interface ThreadCapabilities {
  reply: boolean            // false for back_office/tracker (note-only composer)
  csat, typing, macros, convertToPost, endConversation,
  linkPreviews, inboxTranslation, deepLinkJump, emojiPicker: boolean
  live: boolean             // SSE wiring; tickets true after M3, false until then
  readOnlyBubbles: boolean  // false everywhere once M4 lands (tickets gain reactions/flags)
}
```

Capability matrix:

| Capability                                 | Conversation     | Customer ticket               | Back office / Tracker                     |
| ------------------------------------------ | ---------------- | ----------------------------- | ----------------------------------------- |
| reply                                      | ✓                | ✓                             | ✗ (note-only)                             |
| notes                                      | ✓                | ✓                             | ✓ (default tab)                           |
| reactions / flags / mark-unread / delete   | ✓                | ✓ (new)                       | ✓ (new)                                   |
| macros, AI replies                         | ✓                | ✗ (deferred)                  | ✗                                         |
| typing indicators, CSAT                    | ✓                | ✗                             | ✗                                         |
| snooze                                     | ✓                | ✗ (status axis instead)       | ✗                                         |
| convert-to-post / track feedback           | ✓                | deferred (see 2.7)            | ✗                                         |
| SLA chip                                   | via `slaApplied` | via `dueAt`/`firstResponseAt` | ✗                                         |
| link previews, translation, deep-link jump | ✓                | ✗ initially                   | ✗                                         |
| status propagation to linked tickets       | ✗                | ✗                             | ✓ tracker (existing cascade, server-side) |

Fold specifics (from the audit):

- Replace ticket-thread's hand-rolled row union with `buildAdminConversationRows` (it already
  degrades when unread/typing inputs are absent).
- Replace its local cache/append/loadOlder with `events-reducer.ts` helpers + `useOlderMessages`,
  parameterized by query key.
- The `ComposerDraft`/tab/sendRef/attachment logic exists once, in the unified container.

### 2.6 Chat-bubble restyle (the visual change)

The admin thread adopts the canonical chat-bubble idiom from `VisitorMessageBubble` (already shared
by widget + portal), per the mockup:

- Wrapper: `flex flex-col items-end` (agent/outbound) / `items-start` (customer/inbound).
- Bubble: `max-w-[85%] rounded-2xl px-3.5 py-2.5`; inbound `bg-muted text-foreground`; outbound
  agent `bg-primary text-primary-foreground` (matches widget "self" side; the brand primary reads
  as the agent in admin context).
- Internal notes: same bubble geometry, amber fill `bg-amber-400/10 border border-amber-400/25`
  (preserves the existing note semantics), full width up to the same max-width, aligned right with
  the agent side.
- Meta line below bubble: `text-[11px] text-muted-foreground/70`, "Name · time · Seen/via email",
  right/left aligned per side.
- Preserved features, re-homed onto the bubble: hover toolbar (reactions, flag, overflow menu with
  mark-unread/delete/track actions) anchors to the bubble; flagged state renders a small bookmark
  glyph in the meta line instead of a row tint; citations, pending-action card, translation toggle,
  unread divider, day separators, jumbo-emoji exception all carry over.
- Implementation: restyle `AgentMessageBubble` in place (do NOT fork a second component); extract
  the shared bubble class tokens into a small helper used by both `AgentMessageBubble` and
  `VisitorMessageBubble` so the two cannot drift.
- System/lifecycle events (ticket created from conversation, status changes) render as centered
  pill rows (`sysline` in the mockup).

### 2.7 Header action bar and details panel

Header, left to right (per mockup): title/subtitle block; ticket status dropdown pill when the item
is or links a ticket; icon cluster: Create ticket (plain conversations only), Save for later (star),
Snooze (moon, conversations only), overflow `⋯`; primary button Close (conversations) / Resolve
(tickets, sets the default closed-category status; tracker resolve keeps the existing server-side
cascade).

Overflow `⋯` contents (kind-aware): Export transcript (both), Block person (conversations),
End conversation with reason (conversations), Convert to post (conversations), Copy link (both).

Details panel: merge into one `inbox-detail-panel.tsx` assembled from existing components, sections
in order, each rendered only when applicable:

1. Contact (requester principal): identity + verified/anonymous badge, `CompanyCard` (reuse for
   tickets too, it is principal-scoped), segments, portal activity, previous conversations. Hidden
   for back_office/tracker (no requester).
2. Ticket card (item is or links a ticket): type badge, status control, requester-facing stage,
   SLA due, opened/first-response, ticket custom attributes. Empty slot on plain conversations =
   "Create ticket" affordance.
3. Properties: status/triage, assignee, team, priority, channel (+ channel account), created +
   reference, CSAT (conversations), tags (conversations only, hidden for tickets).
4. Attributes: `ConversationAttributesEditor` generalized to take `SetAttributeTarget` (see 3.5);
   registry definitions apply to both kinds (schema already says so).
5. Links: `TicketLinks` (ported) + linked conversation row + feedback-post affordances.
6. Quinn activity (conversations Quinn touched).

Convert-to-post from tickets is **deferred**: `ConvertToPostDialog` and
`createPostFromConversationFn` stay conversation-keyed. Follow-up if wanted.

### 2.8 Saved views

Extend `lib/shared/conversation/views.ts` rule fields (flat AND list, additive):
`kind` (`conversation|ticket`), `ticket_type`, `ticket_status_category`, `ticket_stage`. The
existing client-side `viewFiltersToListParams` translation grows the matching params on the unified
list call. Rows using ticket fields are hidden when `supportTickets` is off. Max rules stays 15.

### 2.9 Copilot, item-scoped

- New `itemRefSchema` (zod) accepting `{ conversationId } | { ticketId }` (TypeID-validated);
  sibling to `conversation-id.schema.ts`.
- `gateCopilotRequest`: widen bound to the union; branch viewability on
  `assertConversationViewable` vs a new `assertTicketViewable` (backed by `ticketFilter`).
- `copilot.ts` + `transform.ts` request schemas accept the union (transform is authz-only per its
  own doc comment, trivial).
- `runAssistantTurn` grounding: add a ticket context resolver (title, status/stage, requester,
  thread messages) parallel to the conversation context source. Keep scope minimal: Q&A over the
  ticket thread + KB; skip customer-history grounding for back_office/tracker.
- `summarizeConversationNowFn` gains a ticket sibling (or a widened input), writing the summary
  note via `addTicketNote`.
- `assistant_pending_actions`: migration adds nullable `ticket_id` FK + CHECK
  `num_nonnulls(conversation_id, ticket_id) = 1` (conversation_id becomes nullable), extend the
  proposed-partial index to cover both parents; update `pending-actions.service.ts`
  (propose/decide/announce/sweep) and `AssistantToolContext` (+`ticketId`) +
  `buildExecutionContext` in lockstep.
- `CopilotPanel` prop becomes `item: InboxItemRef`; turns state, leak gate, transform machinery
  unchanged.

---

## 3. Server work

### 3.1 Unified list endpoint

New `listInboxItemsFn` (server fn) + `lib/server/domains/inbox/inbox.query.ts`:

- Two-branch query (conversations via `listConversationsForAgent` internals, tickets via a new
  keyset-capable `listTicketsForInbox`), merged on a common sort key
  `activityAt = conversations.lastMessageAt | tickets.updatedAt`, interleaved server-side.
- Compound cursor `{ activityAt, kind, id }`, opaque to the client, re-resolved server-side against
  the named row (same idiom as `conversation.query.ts`; reuse the `SortDescriptor` pattern).
- Filters: triage facet (mapped per 2.1), priority (shared enum), search (conversation branch as
  today; ticket branch adds `search` to `TicketListFilter` reusing the FTS predicate from
  `ticket-search.service.ts`, plus `#N` fast-path), assignee/team, company, ticket
  type/status/stage, view params.
- **RBAC:** apply `conversationFilter(actor)` to the conversation branch (wiring the existing seam;
  this is a deliberate behavior change, see §6) and `ticketFilter(actor)` to the ticket branch. A
  caller lacking `ticket.view` gets a conversations-only feed and vice versa.
- One-row rule per 2.1. The linked-ticket summary joins `ticket_conversations` → `tickets` →
  `ticket_statuses` in the conversation branch enrichment.
- Sorts: `recent` (activityAt), `oldest`, `created`, `priority`, `waiting`/`sla` (conversation-only
  sorts fall back to activityAt for ticket rows; document in code).

New indexes (one migration with 3.3): `tickets (updated_at DESC, id)`, `tickets (created_at, id)`.

New counts endpoint `fetchInboxCountsFn` returning per-scope badge counts (mine, unassigned,
ticket types) in one round trip; cheap COUNTs bounded by the same RBAC predicates,
`staleTime 60s` client-side. Do not build per-tag/segment counts beyond what exists.

### 3.2 SSE ticket events

- `conversation-channels.ts` (rename internals only if trivial): add `ticketChannel(id)` and reuse
  the existing inbox channel (`conversation:inbox`) as THE inbox channel for both kinds; introduce
  `publishTicketEvent(id, event)` / `publishTicketUpdate(id, dto)` mirroring the conversation
  helpers.
- Extend the stream event union with `kind`-tagged ticket variants (`ticket_message`,
  `ticket_updated`, or fold into existing names with an `itemRef`; pick ONE and keep
  `events-reducer.ts` pure/unit-tested).
- Publish sites (mirror conversation.service's pattern, after commit, fire-and-forget):
  `ticket.service.ts` `createTicketCore`, `setTicketStatus`, `assignTicket`, `setTicketPriority`,
  `softDeleteTicket`; `ticket-message.service.ts` `insertTicketMessage` (all three wrappers).
- `stream.ts`: `ticketId=<id>` branch gated by `assertTicketViewable`; inbox scope already covers
  the list (team-member gate unchanged).
- Client: `events-reducer.ts` gains ticket-thread cache patchers (near copy of the agent ones keyed
  on the ticket thread query key); `agentEventChangesInboxList` becomes kind-aware. Ticket 30s
  polling and refetch-on-focus removed once live.

### 3.3 Migration: ticket unread + pending actions + indexes

SQL-first per `packages/db/README.md` (hand-written SQL + `_journal.json` entry + schema TS edit in
the same change; verify with `bun run db:check-drift`). Next free number at audit time: **0177**.

`0177_unified_inbox.sql`:

1. `ALTER TABLE tickets ADD COLUMN requester_last_read_at timestamptz;`
   `ALTER TABLE tickets ADD COLUMN assignee_last_read_at timestamptz;`
   Backfill: `UPDATE tickets SET assignee_last_read_at = updated_at, requester_last_read_at = updated_at WHERE resolved_at IS NOT NULL;`
   (closed history does not light up as unread; open tickets start "unread since last activity",
   which is honest).
2. `CREATE INDEX tickets_updated_at_id_idx ON tickets (updated_at DESC, id);`
   `CREATE INDEX tickets_created_at_id_idx ON tickets (created_at, id);`
3. `ALTER TABLE assistant_pending_actions ALTER COLUMN conversation_id DROP NOT NULL;`
   `ALTER TABLE assistant_pending_actions ADD COLUMN ticket_id typeid REFERENCES tickets(id) ON DELETE CASCADE;`
   `ALTER TABLE assistant_pending_actions ADD CONSTRAINT assistant_pending_actions_parent_check CHECK (num_nonnulls(conversation_id, ticket_id) = 1);`
   Replace the proposed-partial index with two per-parent partials.

Unread services: mirror `unreadCountFor` / batched list unread / `markConversationRead` for tickets
against `conversation_messages WHERE ticket_id = …` (near copy-paste per the audit). Write a
migration test (project rule: every migration ships with one).

### 3.4 Controls and mutations

- Outer `StatusControl`/`PriorityControl`/`AssigneeControl` gain an item-ref + injected mutation
  (or thin ticket variants reusing the shared `*MenuItems`, matching `ticket-controls.tsx` today;
  prefer generalizing the outer control since the ticket wrappers get deleted).
- Bulk: `BulkConversationAction` becomes a kind-aware discriminated action. Uniform verbs
  (assign, assign_team, priority) dispatch per kind; Close maps to conversation close vs default
  closed-category status; Snooze disabled when any ticket selected; mixed selections grey out
  incompatible verbs (no partial application).
- `INBOX_ACTIONS` registry gains `create_ticket` (the audit found the placeholder comment) and
  kind-aware enablement via `isInboxActionEnabled(selection)`.

### 3.5 Attributes

Widen `setConversationAttributeValueFn`'s validator to `SetAttributeTarget` (the domain writer
already supports it; keep the fn name, it is not public API). `ConversationAttributesEditor` takes
the target union. Permissions: conversation targets keep `CONVERSATION_SET_ATTRIBUTES`; ticket
targets gate on `TICKET_SET_STATUS`, the closest existing lifecycle verb (precedent:
`softDeleteTicket` already reuses it, documented inline). Do not add a new RBAC key for this.

---

## 4. Cleanup and deletion (final phase, atomic)

Delete:

- `apps/web/src/routes/admin/tickets.tsx` (replaced by a 15-line redirect route, see 2.2)
- `apps/web/src/components/admin/tickets/ticket-list-column.tsx`, `ticket-thread.tsx`,
  `ticket-detail.tsx`, `ticket-detail-panel.tsx`, `new-ticket-dialog.tsx` and
  `__tests__/ticket-list-column.test.tsx`, `__tests__/ticket-mutations.test.tsx`
- `apps/web/src/lib/client/queries/tickets.ts`, `lib/client/mutations/tickets.ts` (superseded by
  unified inbox queries/mutations)

Move (new home `components/admin/inbox/` or merged files): `ticket-chips.tsx`,
`ticket-controls.tsx` (or its remains after control generalization), `ticket-links.tsx` +
`__tests__/ticket-links.test.tsx`.

Edit:

- `admin-sidebar.tsx`: one Support entry (lines 68-69, 136-137 today).
- `components/admin/users/company-detail.tsx`: "Recent tickets" card links → `/admin/inbox?i=…`
  (keep the card).
- `components/notifications/notification-target.ts`: `ticket_status_changed` →
  `/admin/inbox?i=<ticketId>`; conversation notifications → `i=` param. Update its tests.
- `conversation.convert.ts` + `conversation.notify.ts`: emit `?i=` (legacy `c=` still accepted).
- `settings-nav.tsx`, portal, REST, MCP, settings/tickets, server domain: **no changes**.

Grep gates before closing the phase: zero imports of `components/admin/tickets/` outside the moved
files; zero references to `/admin/tickets` except the redirect route; `routeTree.gen.ts`
regenerated.

---

## 5. Milestones (each: TDD per task, `/simplify` + review at the boundary)

**M1 · Server foundation.** Migration 0177 (+ migration test), ticket unread services, ticket
keyset indexes + `listTicketsForInbox` cursor, `listInboxItemsFn` union endpoint with RBAC wiring
(incl. `conversationFilter`), counts endpoint, `TicketListFilter.search`. Acceptance: unified
endpoint pages stably under concurrent writes; RBAC matrix tests for all four
view/view_all × kind combinations; conversation-only callers see no ticket rows.

**M2 · List + nav + URL.** `i` param + `c` alias + `/admin/tickets` redirect; unified list column
with ticket rows, one-row rule, triage facet; Tickets nav scopes; nav badges; bulk selection across
kinds (uniform verbs only). Acceptance: existing conversation deep links unchanged; ticket deep
links redirect; e2e for mixed-list selection + facet filtering.

**M3 · Realtime.** Ticket SSE end-to-end (channels, publish sites, stream branch, reducer
patchers), remove ticket polling, unread badges live. Acceptance: reducer unit tests for every new
event; two-tab e2e (status change in tab A appears in tab B without refetch).

**M4 · Thread fold + bubble restyle.** Capability object + adapter; delete `ticket-thread.tsx`;
tickets gain reactions/flags/mark-unread; chat-bubble restyle of `AgentMessageBubble` with shared
style tokens; system pill rows. Acceptance: visual parity with mockup on all three item shapes;
all existing thread tests pass against the unified container; note-only composer for
back_office/tracker.

**M5 · Details panel + header actions + views.** Unified panel (assembly per 2.7), header action
bar + kind-aware overflow, attributes target widening, view rule extension, create-ticket flow
(header glyph + ⌘K + panel affordance → existing `createTicketFn` + `ticket_conversations` link +
system pill message). Acceptance: attribute writes on tickets round-trip; a saved view
"kind=ticket, type=customer, category=open" reproduces the old tickets page.

**M6 · Copilot + cleanup.** Item-scoped copilot (gate, schemas, grounding, summarize, pending
actions polymorphism), then the full §4 deletion list + reference edits + grep gates. Acceptance:
copilot Q&A + act-on-approval on a ticket thread; `bun run test && lint && typecheck` green;
deletion grep gates pass.

Estimated net effect: ~2,200 duplicated lines deleted, one page instead of two, tickets inherit
six shell features, one thread/panel/copilot for all future work (workflows surfacing, SLA, email).

---

## 6. Decision log / risks

- **`conversationFilter` wiring is a behavior change**: members holding bare `conversation.view`
  currently see ALL conversations; after M1 they see assigned-to-me-or-my-team only, matching
  tickets and the documented intent of the seam. Call this out in the release notes. Verify during
  M1 whether the `member` system role holds `conversation.view_all` (if so, most workspaces see no
  difference); if it does not, decide whether to grant it in the preset before wiring the filter.
- **Bubble restyle is intentional visual churn** for existing inbox users; it aligns admin, portal,
  and widget on one idiom and is required by the mockup. Screenshot before/after in the PR.
- Conversation-only sorts (`waiting`, `sla`) rank ticket rows by activity; acceptable, documented.
- `tickets.waitingSince` is a dead column today; this spec does not adopt it (tickets have no
  snooze). Leave it; removing is a separate chore.
- Quinn/mentions/saved scopes stay conversation-centric; ticket notes with mentions may surface in
  Mentions for free via polymorphic flags/mentions tables. Verify in M2, do not force.
- Ticket macros, ticket tags, convert-to-post-from-ticket, AND/OR view trees: explicitly deferred
  (§0). `supportTickets` flag survives, repurposed to gate ticket affordances inside the one shell.

---

## 7. Implementation notes (deviations recorded during M1-M6)

A few deliberate deviations from the design above shipped as-is; recorded here rather than
silently left for someone to rediscover:

- **Dual per-branch cursor instead of the single triple.** The unified list endpoint paginates
  conversations and tickets on their own cursors rather than the single interleaved
  `(kind, sortValue, id)` triple sketched in §3.1; the client merges and re-sorts the two pages.
  Simpler to reason about under concurrent writes, at the cost of an extra round-trip per branch.
- **Tag/segment/Quinn/saved-view scopes still read the conversation-only endpoint.** Per the
  decision log (§6), these stay conversation-centric for now; they have not been ported onto the
  unified list's filter params. Ticket rows never appear under those scopes.
- **No `ticket_message_updated` broadcast yet.** Ticket SSE (M3) covers create/status/assign/
  priority/message-added; an edited ticket message does not push a live patch (matches the
  pre-unification ticket surface — not a regression, just not built).
- **Ticket unread is list-level only.** The unified list shows an unread dot per ticket row; there
  is no in-thread unread divider (the conversation thread's read-marker line was not extended to
  tickets).
- **`ticket_status_changed` notifications keep their portal target.** `notification-target.ts`
  keeps routing this type to `/support/ticket/$ticketId` rather than `/admin/inbox?i=`: every
  recipient is a ticket's `requesterPrincipalId`, which `PortalUserPicker`-sourced requesters make
  a portal customer without admin access. `chat_mention`/`chat_message` (team-only recipients) do
  use the new `i=` param.
