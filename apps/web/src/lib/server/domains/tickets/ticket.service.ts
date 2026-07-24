/**
 * Ticket domain service (support platform §4.2): CRUD, the status lifecycle,
 * polymorphic assignment, and the DTO builder. A ticket in phase 7A carries
 * properties only — no message thread — so this module owns the tracked-work
 * columns (status, assignee, priority, SLA timestamps) and never the messages.
 *
 * Postgres is the source of truth. The fn layer gates each entry point on the
 * relevant `ticket.*` permission; the service re-checks (defense in depth) and
 * scopes list reads with `ticketFilter(actor)`.
 *
 * The create path (`createTicketCore`, the Phase 1b backing-conversation
 * intake machinery) lives in the sibling `ticket-intake.service.ts` (the
 * max-lines budget) and is re-exported here so existing callers keep one
 * import site.
 */
import {
  db,
  eq,
  and,
  or,
  isNull,
  inArray,
  lt,
  sql,
  asc,
  desc,
  tickets,
  ticketStatuses,
  conversationMessages,
  ticketConversations,
  conversations,
  principal,
  teams,
  type Ticket,
  type ConversationPriority,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { PrincipalId, TicketId, TicketStatusId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { isTeamMember } from '@/lib/shared/roles'
import { getTeam } from '@/lib/server/domains/teams'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { priorityRankSql } from '@/lib/server/utils/priority-rank'
import {
  ascColumn,
  buildKeysetCondition,
  descColumn,
  type KeysetColumn,
} from '@/lib/server/db/keyset'
import { PRIORITY_RANK } from '@/lib/shared/conversation/priority-meta'
import { getStageLabels } from '../settings/settings.tickets'
import { emitTicketStatusChanged, emitTicketAssigned } from './ticket.webhooks'
import { buildTicketContext, ticketToDTO, ticketRowToDTO } from './ticket.dto'
import { recordTicketActivity } from './ticket-activity.service'
import { safeSubscribeToTicket } from './ticket-subscription.service'
import { ticketFtsMatch } from './ticket-search.service'
import { statusTransition, firstResponseStamp, resolveStage } from './ticket.lifecycle'
import { resolvePairConversationId } from './pair-thread.service'
import { createTicketCore, publishTicketUpdated } from './ticket-intake.service'
import type {
  CreateTicketInput,
  AssignTicketInput,
  TicketListFilter,
  TicketSort,
  TicketDTO,
  TicketListPage,
  BulkTicketAction,
  BulkTicketResult,
} from './ticket.types'

export { resolveStage }
export { createTicketCore }

const log = logger.child({ component: 'tickets' })

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

function assertCan(actor: Actor, permission: PermissionKey, action: string): void {
  if (!can(actor, permission)) throw new ForbiddenError('FORBIDDEN', `You cannot ${action}`)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Load a non-deleted ticket row or throw NotFound. */
export async function loadTicketOr404(id: TicketId): Promise<Ticket> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
    .limit(1)
  if (!row) throw new NotFoundError('TICKET_NOT_FOUND', `Ticket ${id} not found`)
  return row
}

/**
 * The canonical single-ticket authorization chokepoint (unified inbox §2.5):
 * exists, non-deleted, AND passes `ticketFilter(actor)` — the same
 * existence+visibility fusion `assertConversationViewable` uses for
 * conversations, so a caller without `ticket.view`/`ticket.view_all` (or with
 * `ticket.view` on a ticket assigned to someone else / another team) gets
 * NotFound rather than a Forbidden that would leak the ticket's existence.
 *
 * Named `assertTicketVisible` (not `assertTicketViewable`) to stay distinct
 * from the assistant domain's `copilot-gate.ts` helper of that name, which
 * predates this one and now just delegates here — see its doc comment.
 */
export async function assertTicketVisible(id: TicketId, actor: Actor): Promise<Ticket> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), ticketFilter(actor)))
    .limit(1)
  if (!row) throw new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
  return row
}

export async function getTicket(id: TicketId): Promise<TicketDTO> {
  return ticketRowToDTO(await loadTicketOr404(id))
}

const priorityRankExpr = priorityRankSql(tickets.priority)

/**
 * The ordering contract for each ticket sort, as pure data (column +
 * direction). `orderByForTicketSort` and `cursorConditionForTicketSort` both
 * derive from this, so the two can never diverge — and it's directly
 * unit-testable without a database. `priority` ties on `id` alone (no
 * secondary activity tiebreak) — a deliberate simplification vs. the richer
 * conversation sort, so the keyset cursor only ever needs two columns.
 */
export interface TicketSortDescriptor {
  primary: 'updatedAt' | 'createdAt' | 'priorityRank'
  direction: 'asc' | 'desc'
}

export function ticketSortDescriptorFor(sort: TicketSort = 'recent'): TicketSortDescriptor {
  switch (sort) {
    case 'oldest':
      return { primary: 'updatedAt', direction: 'asc' }
    case 'created':
      return { primary: 'createdAt', direction: 'desc' }
    case 'priority':
      return { primary: 'priorityRank', direction: 'desc' }
    case 'recent':
    default:
      return { primary: 'updatedAt', direction: 'desc' }
  }
}

/** ORDER BY clause list for a sort. `id` breaks ties so keyset never dupes/skips. */
function orderByForTicketSort(sort: TicketSort): SQL[] {
  const d = ticketSortDescriptorFor(sort)
  const idTie = d.direction === 'asc' ? asc(tickets.id) : desc(tickets.id)
  switch (d.primary) {
    case 'priorityRank':
      return [desc(priorityRankExpr), idTie]
    case 'createdAt':
      return [d.direction === 'asc' ? asc(tickets.createdAt) : desc(tickets.createdAt), idTie]
    case 'updatedAt':
    default:
      return [d.direction === 'asc' ? asc(tickets.updatedAt) : desc(tickets.updatedAt), idTie]
  }
}

/**
 * Keyset cursor comparison for a sort: rows strictly after the cursor row in
 * the sort's order, assembled by the shared `buildKeysetCondition` (a
 * generic OR-of-ANDs "lexicographic successor" builder — see
 * `lib/server/db/keyset.ts`) from this sort's per-column `equal`/`strict`
 * pair, most-significant-first (the id tiebreak always last). The cursor is
 * re-resolved from the DB (never a client string) so ties are exact. Mirrors
 * conversation.query.ts's `cursorConditionForSort`, which uses the same
 * builder.
 */
function cursorConditionForTicketSort(sort: TicketSort, t: Ticket): SQL {
  const d = ticketSortDescriptorFor(sort)
  const idTie = d.direction === 'asc' ? ascColumn(tickets.id, t.id) : descColumn(tickets.id, t.id)
  switch (d.primary) {
    case 'priorityRank': {
      const rank = PRIORITY_RANK[t.priority] ?? 1
      const rankCol: KeysetColumn = {
        equal: eq(priorityRankExpr, rank),
        strict: lt(priorityRankExpr, rank),
      }
      return buildKeysetCondition([rankCol, idTie])
    }
    case 'createdAt': {
      const col =
        d.direction === 'asc'
          ? ascColumn(tickets.createdAt, t.createdAt)
          : descColumn(tickets.createdAt, t.createdAt)
      return buildKeysetCondition([col, idTie])
    }
    case 'updatedAt':
    default: {
      const col =
        d.direction === 'asc'
          ? ascColumn(tickets.updatedAt, t.updatedAt)
          : descColumn(tickets.updatedAt, t.updatedAt)
      return buildKeysetCondition([col, idTie])
    }
  }
}

/**
 * The one-row-rule predicate, restated as the CONVERGENCE rule
 * (scratchpad/convergence-design.md Phase 2 — alias semantics; originally
 * UNIFIED-INBOX-SPEC.md §2.1): a `type: 'customer'` ticket with an active
 * `ticket_conversations` link IS its conversation. The pair is ONE item —
 * it lists as the conversation row (the ticket chip on it deep-links the
 * same pair), counts once in nav badges, and never appears as a second
 * ticket row in any inbox scope. Back-office and tracker tickets are never
 * excluded — the type guard is part of the condition, not just a filter
 * alongside it, since a back-office/tracker ticket can still carry a link
 * row (tracker cascade links, notably) without being conversation-backed
 * (their links are context, never a shared thread). Exported so
 * `inbox.query.ts`'s count endpoint can reuse the identical predicate rather
 * than re-deriving it.
 */
export function excludeConversationLinkedCondition(): SQL {
  return sql`NOT (${tickets.type} = 'customer' AND EXISTS (
    SELECT 1 FROM ${ticketConversations} tc WHERE tc.ticket_id = ${tickets.id}
  ))`
}

/**
 * List tickets for an agent, filtered + sorted, scoped by `ticketFilter(actor)`.
 * Soft-deleted tickets are excluded. Status-category and stage filters resolve
 * through subqueries on ticket_statuses so the outer select stays tickets-only.
 * `filter.search` reuses the FTS predicate from `ticket-search.service.ts`
 * (title + message `search_vector`, agent audience so internal notes count),
 * with a `#N`/`N` ticket-number fast path OR'd in. Keyset-paginated:
 * `filter.cursor` is the previous page's last ticket id, re-resolved
 * server-side against the active sort (mirrors `listConversationsForAgent`) so
 * a page boundary can't be spoofed and ties are handled deterministically.
 */
export async function listTickets(filter: TicketListFilter, actor: Actor): Promise<TicketListPage> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
  const sort = filter.sort ?? 'recent'

  let cursor: Ticket | null = null
  if (filter.cursor) {
    const [row] = await db.select().from(tickets).where(eq(tickets.id, filter.cursor)).limit(1)
    if (row) cursor = row
  }

  const assigneeCondition =
    filter.assignee === 'me'
      ? actor.principalId
        ? eq(tickets.assigneePrincipalId, actor.principalId)
        : sql`false`
      : filter.assignee === 'unassigned'
        ? isNull(tickets.assigneePrincipalId)
        : filter.assignee
          ? eq(tickets.assigneePrincipalId, filter.assignee)
          : undefined

  const search = filter.search?.trim()
  // A bare or `#`-prefixed integer is also a ticket-number fast path, OR'd
  // onto the FTS match — "42" finds ticket #42 as well as any FTS hit on "42".
  const searchCondition = search
    ? (() => {
        const { condition } = ticketFtsMatch(search)
        const numMatch = /^#?(\d+)$/.exec(search)
        return numMatch ? or(condition, eq(tickets.number, Number(numMatch[1])))! : condition
      })()
    : undefined

  const rows = await db
    .select()
    .from(tickets)
    .where(
      and(
        // ticketFilter(actor) already excludes soft-deleted rows in every branch.
        ticketFilter(actor),
        filter.type ? eq(tickets.type, filter.type) : undefined,
        filter.ticketTypeId ? eq(tickets.ticketTypeId, filter.ticketTypeId) : undefined,
        filter.priority ? eq(tickets.priority, filter.priority) : undefined,
        filter.excludeConversationLinked ? excludeConversationLinkedCondition() : undefined,
        filter.statusCategory
          ? inArray(
              tickets.statusId,
              db
                .select({ id: ticketStatuses.id })
                .from(ticketStatuses)
                .where(eq(ticketStatuses.category, filter.statusCategory))
            )
          : undefined,
        filter.stage
          ? inArray(
              tickets.statusId,
              db
                .select({ id: ticketStatuses.id })
                .from(ticketStatuses)
                .where(eq(ticketStatuses.publicStage, filter.stage))
            )
          : undefined,
        assigneeCondition,
        filter.teamId ? eq(tickets.assigneeTeamId, filter.teamId) : undefined,
        filter.requesterPrincipalId
          ? eq(tickets.requesterPrincipalId, filter.requesterPrincipalId)
          : undefined,
        filter.companyId ? eq(tickets.companyId, filter.companyId) : undefined,
        searchCondition,
        // Keyset comparison for the active sort (re-resolved cursor row). id is
        // always the final tiebreak so a page boundary never dupes or skips.
        cursor ? cursorConditionForTicketSort(sort, cursor) : undefined
      )
    )
    .orderBy(...orderByForTicketSort(sort))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const ctx = await buildTicketContext(page)
  return { tickets: page.map((r) => ticketToDTO(r, ctx)), hasMore }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Open a ticket as an agent (any type, optional requester). Agent-created
 * tickets are born OWNED: the assignee defaults to the source conversation's
 * assignee (`input.sourceConversationId`, the create-from-a-conversation
 * flow), else to the creating agent — an explicit `input.assigneePrincipalId`
 * always wins and is validated like an `assignTicket` target. The company
 * propagates from the requester's own `principal.companyId` when the ticket
 * has a requester and no explicit company.
 *
 * Converged Messages (agent-only creation): a customer ticket opened FOR a
 * requester without a source conversation is born as its conversation pair
 * (`withBackingConversation`), so it appears on the requester's Messages
 * surface — otherwise the ticket would be invisible to its own requester.
 */
export async function createTicket(input: CreateTicketInput, actor: Actor): Promise<TicketDTO> {
  assertCan(actor, PERMISSIONS.TICKET_CREATE, 'create a ticket')

  // Assignee resolution: explicit > source conversation's assignee > creating
  // agent. The two defaults are best-effort — a missing conversation or a
  // creator whose principal doesn't resolve to a team member simply leaves
  // the ticket unassigned (a default must never fail the create); an EXPLICIT
  // assignee, by contrast, is validated hard, mirroring assignTicket.
  let assigneePrincipalId = input.assigneePrincipalId ?? null
  if (assigneePrincipalId) {
    const [assignee] = await db
      .select({ role: principal.role })
      .from(principal)
      .where(eq(principal.id, assigneePrincipalId))
      .limit(1)
    if (!assignee || !isTeamMember(assignee.role)) {
      throw new ValidationError('INVALID_ASSIGNEE', 'Can only assign to a team member')
    }
  } else if (input.sourceConversationId) {
    const [conversation] = await db
      .select({ assigned: conversations.assignedAgentPrincipalId })
      .from(conversations)
      .where(eq(conversations.id, input.sourceConversationId))
      .limit(1)
    assigneePrincipalId = conversation?.assigned ?? null
  }
  if (!assigneePrincipalId && actor.principalId) {
    const [creator] = await db
      .select({ role: principal.role })
      .from(principal)
      .where(eq(principal.id, actor.principalId))
      .limit(1)
    if (creator && isTeamMember(creator.role)) assigneePrincipalId = actor.principalId
  }

  // Company propagation: the requester's own company fills in when nothing
  // explicit was passed; a requester-less ticket stays company-less.
  let companyId = input.companyId ?? null
  if (!companyId && input.requesterPrincipalId) {
    const [requester] = await db
      .select({ companyId: principal.companyId })
      .from(principal)
      .where(eq(principal.id, input.requesterPrincipalId))
      .limit(1)
    companyId = requester?.companyId ?? null
  }

  return createTicketCore(
    {
      ...input,
      assigneePrincipalId,
      companyId,
      // The create-from-a-conversation flow stays standalone here — it links
      // its SOURCE conversation right after this call, and the pair unique
      // would reject that second link if a backing conversation were minted
      // first. An explicit withBackingConversation (API v1 / MCP) always wins.
      withBackingConversation:
        input.withBackingConversation ??
        (input.type === 'customer' && !!input.requesterPrincipalId && !input.sourceConversationId),
    },
    actor
  )
}

/**
 * Set a ticket's status. Entering a closed-category status stamps `resolvedAt`;
 * leaving one clears it and increments `reopenedCount`. An agent action also
 * stamps `firstResponseAt` the first time.
 */
export async function setTicketStatus(
  id: TicketId,
  statusId: TicketStatusId,
  actor: Actor
): Promise<TicketDTO> {
  assertCan(actor, PERMISSIONS.TICKET_SET_STATUS, 'change this ticket status')
  const existing = await loadTicketOr404(id)

  // Independent reads, so run them together. `current` intentionally omits the
  // deletedAt guard: a ticket may still sit on a since-deleted status and we need
  // its category to compute the transition.
  const [[target], [current]] = await Promise.all([
    db
      .select({
        name: ticketStatuses.name,
        category: ticketStatuses.category,
        publicStage: ticketStatuses.publicStage,
      })
      .from(ticketStatuses)
      .where(and(eq(ticketStatuses.id, statusId), isNull(ticketStatuses.deletedAt)))
      .limit(1),
    db
      .select({
        name: ticketStatuses.name,
        category: ticketStatuses.category,
        publicStage: ticketStatuses.publicStage,
      })
      .from(ticketStatuses)
      .where(eq(ticketStatuses.id, existing.statusId))
      .limit(1),
  ])
  if (!target) throw new NotFoundError('STATUS_NOT_FOUND', `Ticket status ${statusId} not found`)

  const now = new Date()
  const previousCategory = current?.category ?? 'open'
  const transition = statusTransition(previousCategory, target.category, now)
  const patch: Partial<Ticket> = { statusId, updatedAt: now }
  if (transition.resolvedAt !== undefined) patch.resolvedAt = transition.resolvedAt
  if (transition.reopenedIncrement) {
    patch.reopenedCount = sql`${tickets.reopenedCount} + 1` as unknown as number
  }
  const stamp = firstResponseStamp(existing.firstResponseAt, isTeamMember(actor.role), now)
  if (stamp) patch.firstResponseAt = stamp

  const [updated] = await db.update(tickets).set(patch).where(eq(tickets.id, id)).returning()

  // Durable timeline record (fire-and-forget): EVERY real status move is
  // recorded, including internal churn the customer-facing stage event below
  // stays silent on. A same-status no-op set records nothing.
  if (existing.statusId !== statusId) {
    recordTicketActivity({
      ticketId: id,
      principalId: actor.principalId,
      type: 'status.changed',
      metadata: {
        fromId: existing.statusId,
        fromName: current?.name ?? null,
        toId: statusId,
        toName: target.name,
      },
    })
  }

  // Realtime signal (unified inbox §3.2, M3), unconditional like the webhook
  // below — mirrors conversation.service's publish-right-after-the-UPDATE
  // pattern. Computed once and reused for the function's return value.
  const dto = await publishTicketUpdated(updated)

  // previousStage is unrecoverable once the UPDATE above commits (the prior
  // status row's own publicStage isn't carried anywhere else), so it's
  // captured here — off `current`, read before the write — and threaded
  // through the hook alongside the requester, for the requester-bell
  // resolver's crossing check (events/targets.ts's
  // getTicketStatusChangedTargets, WO-3 slice 4).
  const previousStage = current ? resolveStage(current) : null

  // Agent/integration-facing signal: every internal status move fires a hook
  // (mirrors conversation.status_changed), reporting the category axis.
  void emitTicketStatusChanged(
    actor,
    updated,
    previousCategory,
    target.category,
    resolveStage(target),
    previousStage,
    existing.requesterPrincipalId ?? null
  )

  // A public_stage crossing to a visible stage is the single customer-facing
  // signal (§4.2): post a status event into the ticket thread. Null-stage and
  // same-stage churn stay silent (customers hear stage progress, not internal
  // churn) — with one exception (B22): closing a CUSTOMER ticket via a
  // null-stage status ("Won't do", "Duplicate") posts the generic "Ticket
  // closed" marker (`stageLabel` null + `closed: true`), so the requester
  // gets the same in-thread close signal a resolved close gives, without the
  // internal status name ever leaking. Back-office/tracker tickets keep the
  // old silence: their threads are internal surfaces that already show the
  // raw internal status, so a generic marker would be noise (pinned by
  // ticket-links.service.test.ts's null-stage cascade test). The requester
  // bell now rides the ticket.status_changed event/hook pipeline above (WO-3
  // slice 4) — the system-1 email (§4.8) and the conversation echo ride the
  // same crossing later.
  const newStage = resolveStage(target)
  if (newStage && newStage !== previousStage) {
    const stageLabels = await getStageLabels()
    await postTicketStatusEvent(id, stageLabels[newStage])
  } else if (
    !newStage &&
    existing.type === 'customer' &&
    previousCategory !== 'closed' &&
    target.category === 'closed'
  ) {
    await postTicketStatusEvent(id, null)
  }

  // A tracker fans its status onto the customer tickets it tracks (§4.9),
  // driven off the CATEGORY transition — entering closed, reopening out of it,
  // or an open<->pending move — never off the stage crossing. The old
  // stage-driven rule meant closing a tracker via a null-stage status ("Won't
  // do", "Duplicate") cascaded nothing, leaving the tracked tickets open under
  // a closed tracker permanently. The cascade is internal plumbing, so it runs
  // even when the customer-facing stage event above legitimately stays silent
  // for a null-stage status.
  if (existing.type === 'tracker' && previousCategory !== target.category) {
    await cascadeTrackerStatus(id, statusId, actor)
  }

  return dto
}

/**
 * Fan a tracker's new status onto the customer tickets it tracks (§4.9). Each
 * linked ticket takes the tracker's status via setTicketStatus, so it runs its
 * own transition + requester notification. A linked ticket already in a closed
 * category is skipped — the cascade never regresses a resolved ticket. Per-link
 * best-effort: the tracker's own update already committed, so one failing link
 * is logged, not fatal. The dynamic import breaks the ticket.service <->
 * ticket-links static cycle.
 */
async function cascadeTrackerStatus(
  trackerId: TicketId,
  statusId: TicketStatusId,
  actor: Actor
): Promise<void> {
  const { listLinkedTicketIds } = await import('./ticket-links.service')
  const linkedIds = await listLinkedTicketIds(trackerId)
  for (const linkedId of linkedIds) {
    try {
      const linked = await db
        .select({ statusId: tickets.statusId })
        .from(tickets)
        .where(and(eq(tickets.id, linkedId), isNull(tickets.deletedAt)))
        .limit(1)
        .then((r) => r[0])
      if (!linked || linked.statusId === statusId) continue
      const [current] = await db
        .select({ category: ticketStatuses.category })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.id, linked.statusId))
        .limit(1)
      if (current?.category === 'closed') continue // never regress a resolved ticket
      await setTicketStatus(linkedId, statusId, actor)
    } catch (err) {
      log.warn({ err, tracker_id: trackerId, linked_id: linkedId }, 'tracker cascade: link failed')
    }
  }
}

/** Post a customer-visible status event into a ticket's thread (never the raw
 *  internal status name — only the public stage label).
 *
 *  `stageLabel` null is the B22 generic close: the ticket was closed via a
 *  null-`publicStage` status ("Won't do", "Duplicate"), so the marker is the
 *  localized-at-render "Ticket closed" projection (`closed: true`, no label)
 *  — the customer hears the close without the internal status name leaking.
 *
 *  CONVERGENCE PHASE 1a (three-path contract, see ticket-message.service.ts's
 *  module doc): on a linked customer pair the stage event re-parents to the
 *  CONVERSATION via the conversation domain's own `emitSystemMessage`, so it
 *  renders as the in-thread status event on the shared thread (Intercom's
 *  state-change-in-thread) and publishes on the conversation channel.
 *  Back-office/tracker tickets and standalone customer tickets stay
 *  ticket-parented (the resolve call is customer-link-scoped). */
async function postTicketStatusEvent(ticketId: TicketId, stageLabel: string | null): Promise<void> {
  // The stored content stays the English fallback for agent surfaces and
  // legacy readers; portal/widget clients localize from the structured event
  // (B25), so the sentence is never frozen-at-write English on customer
  // surfaces. The generic close stores no label at all.
  const systemEvent = stageLabel
    ? { kind: 'ticket_status_changed' as const, stageLabel }
    : { kind: 'ticket_status_changed' as const, closed: true }
  const content = stageLabel ? `Status updated to ${stageLabel}` : 'Ticket closed'
  const pairConversationId = await resolvePairConversationId(ticketId)
  if (pairConversationId) {
    const { emitSystemMessage } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await emitSystemMessage(pairConversationId, content, systemEvent)
    return
  }
  await db.insert(conversationMessages).values({
    ticketId,
    principalId: null,
    senderType: 'system',
    content,
    metadata: { systemEvent },
  })
}

/**
 * A requester reply reopens a ticket that was awaiting them or closed (§4.2, the
 * ticket-axis analogue of conversation reopen): from an `awaiting_requester`-
 * projecting status OR a `closed` category, move to the first open-category status
 * (clearing resolved_at + counting the reopen when leaving closed). No-op
 * otherwise. No permission check — the trigger is a requester reply on their own
 * ticket, verified upstream (`byPrincipalId` is that requester, recorded as the
 * activity actor and carried as the event actor; null keeps both fully
 * system-attributed). Returns whether it moved.
 *
 * The reopen emits the SAME signals `setTicketStatus` does — the realtime
 * publish, the `ticket.status_changed` event (categories + stages), and the
 * customer-facing thread stage notice on a real stage crossing — so every
 * event consumer (the SLA hook's pending-resume, watcher notifications,
 * webhooks, workflows) treats a requester-reply reopen exactly like an agent's
 * status move. The durable timeline keeps its distinct `ticket.reopened` type,
 * though: the history must read "reopened by the requester's reply", not an
 * anonymous status flip.
 */
export async function autoReopenOnRequesterReply(
  id: TicketId,
  byPrincipalId: PrincipalId | null = null
): Promise<boolean> {
  const existing = await loadTicketOr404(id)
  const [current] = await db
    .select({
      name: ticketStatuses.name,
      category: ticketStatuses.category,
      publicStage: ticketStatuses.publicStage,
    })
    .from(ticketStatuses)
    .where(eq(ticketStatuses.id, existing.statusId))
    .limit(1)
  if (!current) return false
  const awaiting = resolveStage(current) === 'awaiting_requester'
  if (!awaiting && current.category !== 'closed') return false

  const [firstOpen] = await db
    .select({
      id: ticketStatuses.id,
      name: ticketStatuses.name,
      publicStage: ticketStatuses.publicStage,
    })
    .from(ticketStatuses)
    .where(and(eq(ticketStatuses.category, 'open'), isNull(ticketStatuses.deletedAt)))
    .orderBy(asc(ticketStatuses.position))
    .limit(1)
  if (!firstOpen || firstOpen.id === existing.statusId) return false

  const now = new Date()
  const transition = statusTransition(current.category, 'open', now)
  const patch: Partial<Ticket> = { statusId: firstOpen.id, updatedAt: now }
  if (transition.resolvedAt !== undefined) patch.resolvedAt = transition.resolvedAt
  if (transition.reopenedIncrement) {
    patch.reopenedCount = sql`${tickets.reopenedCount} + 1` as unknown as number
  }
  const [updated] = await db.update(tickets).set(patch).where(eq(tickets.id, id)).returning()

  // Durable timeline record (fire-and-forget): a distinct 'ticket.reopened'
  // type — not 'status.changed' — so the timeline reads honestly ("reopened by
  // the requester's reply") rather than as an anonymous status flip.
  recordTicketActivity({
    ticketId: id,
    principalId: byPrincipalId,
    type: 'ticket.reopened',
    metadata: {
      fromId: existing.statusId,
      fromName: current.name,
      toId: firstOpen.id,
      toName: firstOpen.name,
      trigger: 'requester_reply',
    },
  })

  // Realtime signal, mirroring setTicketStatus (unified inbox §3.2, M3): an
  // inbox row re-render on the reopen. The returned DTO is unused here (this
  // path returns whether it moved).
  await publishTicketUpdated(updated)

  // Agent/integration-facing signal, mirroring setTicketStatus. previousStage
  // is captured off the pre-write status row (unrecoverable after the UPDATE
  // commits). The event actor is the requester themselves — synthesized the
  // same way appendInboundTicketReply's is (a requester is never a service
  // principal, so role/segments stay empty), so downstream actor gating treats
  // the move as a human action, which it is. The SLA event hook's
  // pending-resume rides this event (resumeTicketSlaFromPending no-ops when no
  // stamp is paused), so this path needs no direct SLA call of its own.
  const previousStage = resolveStage(current)
  const newStage = resolveStage(firstOpen)
  const actor: Actor = {
    principalId: byPrincipalId,
    role: null,
    principalType: 'user',
    segmentIds: new Set(),
  }
  void emitTicketStatusChanged(
    actor,
    updated,
    current.category,
    'open',
    newStage,
    previousStage,
    existing.requesterPrincipalId ?? null
  )

  // The customer-facing thread stage notice, mirroring setTicketStatus: a real
  // public_stage crossing posts the stage event; a null target stage stays
  // silent, exactly as there.
  if (newStage && newStage !== previousStage) {
    const stageLabels = await getStageLabels()
    await postTicketStatusEvent(id, stageLabels[newStage])
  }

  return true
}

/**
 * Assign a ticket to a teammate and/or a team. Polymorphic and independent: an
 * absent key leaves that side untouched (no clearing rule — mirrors the
 * conversation team assignment). Pass an explicit null to clear one side.
 */
export async function assignTicket(
  id: TicketId,
  input: AssignTicketInput,
  actor: Actor
): Promise<TicketDTO> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'assign this ticket')
  const existing = await loadTicketOr404(id)

  const patch: Partial<Ticket> = { updatedAt: new Date() }

  if (input.assigneePrincipalId !== undefined) {
    if (input.assigneePrincipalId) {
      const [assignee] = await db
        .select({ role: principal.role })
        .from(principal)
        .where(eq(principal.id, input.assigneePrincipalId))
        .limit(1)
      if (!assignee || !isTeamMember(assignee.role)) {
        throw new ValidationError('INVALID_ASSIGNEE', 'Can only assign to a team member')
      }
    }
    patch.assigneePrincipalId = input.assigneePrincipalId
  }

  if (input.assigneeTeamId !== undefined) {
    // getTeam throws NotFound if the team is missing or soft-deleted.
    if (input.assigneeTeamId) await getTeam(input.assigneeTeamId)
    patch.assigneeTeamId = input.assigneeTeamId
  }

  const stamp = firstResponseStamp(existing.firstResponseAt, isTeamMember(actor.role))
  if (stamp) patch.firstResponseAt = stamp

  const [updated] = await db.update(tickets).set(patch).where(eq(tickets.id, id)).returning()

  // Realtime signal (unified inbox §3.2, M3): unconditional, unlike the
  // webhook below — an inbox row re-render on a no-op re-assign is harmless,
  // while a missed signal on an actual reorder-relevant change is not.
  const dto = await publishTicketUpdated(updated)

  // Only signal when an assignee actually moved (a no-op re-assign must not fire).
  if (
    existing.assigneePrincipalId !== updated.assigneePrincipalId ||
    existing.assigneeTeamId !== updated.assigneeTeamId
  ) {
    // A real assignment re-opts the assignee in as a watcher (even after an
    // explicit unwatch). Must never fail the assignment itself.
    if (
      updated.assigneePrincipalId &&
      existing.assigneePrincipalId !== updated.assigneePrincipalId
    ) {
      await safeSubscribeToTicket(updated.assigneePrincipalId, id, 'assignee')
    }
    void emitTicketAssigned(
      actor,
      updated,
      existing.assigneePrincipalId ?? null,
      existing.assigneeTeamId ?? null
    )
    // Durable timeline record (fire-and-forget), same moved-only gate as the
    // webhook. Names are resolved inline (the same idiom as the post domain's
    // status activity) so the row is self-describing even after a principal
    // or team is later deleted.
    recordTicketActivity({
      ticketId: id,
      principalId: actor.principalId,
      type: 'ticket.assigned',
      metadata: await assignmentActivityMetadata(existing, updated),
    })
  }
  return dto
}

/**
 * from/to metadata for a 'ticket.assigned' activity row: only the side(s)
 * that actually moved are included, each as id + display name (name lookups
 * batched; a missing row resolves to a null name, never an error).
 */
async function assignmentActivityMetadata(
  existing: Ticket,
  updated: Ticket
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {}

  if (existing.assigneePrincipalId !== updated.assigneePrincipalId) {
    const ids = [existing.assigneePrincipalId, updated.assigneePrincipalId].filter(
      (v): v is PrincipalId => v !== null
    )
    const rows = ids.length
      ? await db
          .select({ id: principal.id, name: principal.displayName })
          .from(principal)
          .where(inArray(principal.id, ids))
      : []
    const names = new Map(rows.map((r) => [r.id, r.name]))
    metadata.fromPrincipalId = existing.assigneePrincipalId
    metadata.fromPrincipalName = existing.assigneePrincipalId
      ? (names.get(existing.assigneePrincipalId) ?? null)
      : null
    metadata.toPrincipalId = updated.assigneePrincipalId
    metadata.toPrincipalName = updated.assigneePrincipalId
      ? (names.get(updated.assigneePrincipalId) ?? null)
      : null
  }

  if (existing.assigneeTeamId !== updated.assigneeTeamId) {
    const ids = [existing.assigneeTeamId, updated.assigneeTeamId].filter((v) => v !== null)
    const rows = ids.length
      ? await db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, ids))
      : []
    const names = new Map(rows.map((r) => [r.id, r.name]))
    metadata.fromTeamId = existing.assigneeTeamId
    metadata.fromTeamName = existing.assigneeTeamId
      ? (names.get(existing.assigneeTeamId) ?? null)
      : null
    metadata.toTeamId = updated.assigneeTeamId
    metadata.toTeamName = updated.assigneeTeamId
      ? (names.get(updated.assigneeTeamId) ?? null)
      : null
  }

  return metadata
}

/** Set a ticket's triage priority (reuses the conversation priority scale). */
export async function setTicketPriority(
  id: TicketId,
  priority: ConversationPriority,
  actor: Actor
): Promise<TicketDTO> {
  assertCan(actor, PERMISSIONS.TICKET_SET_STATUS, 'change this ticket priority')
  const existing = await loadTicketOr404(id)
  const now = new Date()
  const patch: Partial<Ticket> = { priority, updatedAt: now }
  const stamp = firstResponseStamp(existing.firstResponseAt, isTeamMember(actor.role), now)
  if (stamp) patch.firstResponseAt = stamp
  const [updated] = await db.update(tickets).set(patch).where(eq(tickets.id, id)).returning()
  // Durable timeline record (fire-and-forget); a no-op re-set records nothing.
  if (existing.priority !== priority) {
    recordTicketActivity({
      ticketId: id,
      principalId: actor.principalId,
      type: 'priority.changed',
      metadata: { from: existing.priority, to: priority },
    })
  }
  // Realtime signal (unified inbox §3.2, M3).
  return publishTicketUpdated(updated)
}

// ---------------------------------------------------------------------------
// Bulk mutation (support platform §4.6, ticket axis)
// ---------------------------------------------------------------------------

/**
 * Apply one action to many tickets (support platform §4.6's ticket-axis
 * counterpart of the conversation bulk actions). Loops the SAME
 * single-ticket ops (`assignTicket`/`setTicketPriority`/`setTicketStatus`)
 * their individual server fns call — never a bypass of their `assertCan`
 * checks, realtime publish, or webhook — so a bulk apply is exactly N
 * individual applies. Per-item isolation: one ticket's failure (missing,
 * forbidden, an invalid target) lands in `failed` and never aborts the rest
 * of the batch.
 */
export async function bulkUpdateTickets(
  ticketIds: TicketId[],
  action: BulkTicketAction,
  actor: Actor
): Promise<BulkTicketResult> {
  const apply: (id: TicketId) => Promise<unknown> = (() => {
    switch (action.type) {
      case 'assign':
        return (id) => assignTicket(id, { assigneePrincipalId: action.assignTo }, actor)
      case 'assign_team':
        return (id) => assignTicket(id, { assigneeTeamId: action.teamId }, actor)
      case 'priority':
        return (id) => setTicketPriority(id, action.priority, actor)
      case 'set_status':
        return (id) => setTicketStatus(id, action.statusId, actor)
    }
  })()

  const succeeded: TicketId[] = []
  const failed: { id: TicketId; reason: string }[] = []
  for (const id of ticketIds) {
    try {
      await apply(id)
      succeeded.push(id)
    } catch (error) {
      failed.push({ id, reason: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  return { succeeded, failed }
}

/**
 * Soft-delete a ticket. There is no dedicated delete permission in the
 * catalogue, so this gates on TICKET_SET_STATUS (the closest lifecycle verb).
 */
export async function softDeleteTicket(id: TicketId, actor: Actor): Promise<void> {
  assertCan(actor, PERMISSIONS.TICKET_SET_STATUS, 'delete this ticket')
  await loadTicketOr404(id)
  const [updated] = await db
    .update(tickets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
    .returning()
  if (updated) {
    // Durable timeline record (fire-and-forget) — invisible while the ticket
    // stays soft-deleted, but it keeps the history honest if it is restored.
    recordTicketActivity({
      ticketId: id,
      principalId: actor.principalId,
      type: 'ticket.deleted',
    })
    // Realtime signal (unified inbox §3.2, M3): the list re-query already
    // excludes a deleted ticket via ticketFilter, so the refetch this triggers
    // is what actually makes the row disappear for every other viewer.
    await publishTicketUpdated(updated)
  }
}
