/**
 * Ticket domain service (support platform §4.2): CRUD, the status lifecycle,
 * polymorphic assignment, and the DTO builder. A ticket in phase 7A carries
 * properties only — no message thread — so this module owns the tracked-work
 * columns (status, assignee, priority, SLA timestamps) and never the messages.
 *
 * Postgres is the source of truth. The fn layer gates each entry point on the
 * relevant `ticket.*` permission; the service re-checks (defense in depth) and
 * scopes list reads with `ticketFilter(actor)`.
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
  principal,
  type Ticket,
  type ConversationPriority,
} from '@/lib/server/db'
import {
  validateContent,
  validateAttachments,
  resolveMessageContent,
  richMessageFallbackLabel,
} from '@/lib/server/messages/message-core'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import type { SQL } from 'drizzle-orm'
import type { TicketId, TicketStatusId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { isTeamMember } from '@/lib/shared/roles'
import { getTeam } from '@/lib/server/domains/teams'
import { NotFoundError, ValidationError, ForbiddenError, InternalError } from '@/lib/shared/errors'
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
import { createNotification } from '../notifications/notification.service'
import { publishTicketEvent } from '@/lib/server/realtime/conversation-channels'
import { emitTicketCreated, emitTicketStatusChanged, emitTicketAssigned } from './ticket.webhooks'
import { buildTicketContext, ticketToDTO, ticketRowToDTO } from './ticket.dto'
import { ticketFtsMatch } from './ticket-search.service'
import { statusTransition, firstResponseStamp, resolveStage } from './ticket.lifecycle'
import type {
  CreateTicketInput,
  AssignTicketInput,
  TicketListFilter,
  TicketSort,
  TicketDTO,
  TicketListPage,
} from './ticket.types'

export { resolveStage }

const log = logger.child({ component: 'tickets' })

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100
const MAX_TITLE_LENGTH = 300

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
 * The unified inbox's one-row-rule predicate (UNIFIED-INBOX-SPEC.md §2.1):
 * exclude a `type: 'customer'` ticket that has an active `ticket_conversations`
 * link (it renders as its linked conversation's row in the union endpoint
 * instead). Back-office and tracker tickets are never excluded — the type
 * guard is part of the condition, not just a filter alongside it, since a
 * back-office/tracker ticket can still carry a link row (tracker cascade
 * links, notably) without losing its own row. Exported so
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
 * Rebuild a ticket's DTO and fan the unified-inbox realtime signal (unified
 * inbox §3.2, M3) — the common tail of every mutator below (create, status,
 * assign, priority, soft-delete): re-enrich the just-written row, then
 * `publishTicketEvent('ticket_updated')` so every open inbox re-renders the
 * row. Returns the DTO so callers can still return/reuse it.
 */
async function publishTicketUpdated(row: Ticket): Promise<TicketDTO> {
  const dto = await ticketRowToDTO(row)
  publishTicketEvent(row.id, { kind: 'ticket_updated', ticket: dto })
  return dto
}

/**
 * Open a ticket WITHOUT a permission check — the caller authorizes (agent
 * TICKET_CREATE via createTicket, or requester self-creation via createMyTicket).
 * Resolves the default status; `number` auto-increments.
 */
export async function createTicketCore(input: CreateTicketInput, actor: Actor): Promise<TicketDTO> {
  const title = input.title?.trim()
  if (!title) throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Title must be ${MAX_TITLE_LENGTH} characters or less`
    )
  }

  const [defaultStatus] = await db
    .select({
      id: ticketStatuses.id,
      category: ticketStatuses.category,
      publicStage: ticketStatuses.publicStage,
    })
    .from(ticketStatuses)
    .where(and(eq(ticketStatuses.isDefault, true), isNull(ticketStatuses.deletedAt)))
    .limit(1)
  if (!defaultStatus) {
    throw new InternalError('NO_DEFAULT_STATUS', 'No default ticket status is configured')
  }

  // Same sanitize/validate idioms as insertTicketMessage (ticket-message.service):
  // sanitize the doc, cap/validate attachments, derive the plaintext mirror from
  // the doc when the raw description is blank, and let a text-less rich doc
  // (image/embed) satisfy the empty-content guard via its fallback label. Run
  // ahead of the transaction — it's pure validation, no I/O.
  const openingAttachments = validateAttachments(input.attachments)
  // The description is the requester's own ask when they file the ticket
  // themselves — their inline images may only reference our own storage.
  const filedByRequester =
    !!actor.principalId && actor.principalId === (input.requesterPrincipalId ?? null)
  const safeDescriptionJson = input.descriptionJson
    ? sanitizeTiptapContent(input.descriptionJson, {
        restrictImagesToTrustedOrigins: filedByRequester,
      })
    : null
  const fallbackLabel = richMessageFallbackLabel(safeDescriptionJson)
  const resolvedDescription = resolveMessageContent(input.description ?? '', safeDescriptionJson)
  const hasOpeningMessage =
    !!resolvedDescription.trim() || openingAttachments.length > 0 || !!fallbackLabel

  const created = await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        type: input.type,
        title,
        statusId: defaultStatus.id,
        priority: input.priority ?? 'none',
        requesterPrincipalId: input.requesterPrincipalId ?? null,
        companyId: input.companyId ?? null,
        customAttributes: input.customAttributes ?? {},
      })
      .returning()

    if (hasOpeningMessage) {
      // The description opens the thread. It is the requester's ask when they
      // file it themselves (senderType 'visitor'), or a teammate's summary when
      // filing on someone's behalf ('agent'). Either way it is the opening
      // message, not a reply, so it never stamps first_response_at.
      const filedByRequester =
        !!actor.principalId && actor.principalId === (input.requesterPrincipalId ?? null)
      await tx.insert(conversationMessages).values({
        ticketId: ticket.id,
        principalId: actor.principalId,
        senderType: filedByRequester ? 'visitor' : 'agent',
        content: validateContent(
          resolvedDescription,
          openingAttachments.length > 0 || !!fallbackLabel
        ),
        contentJson: safeDescriptionJson,
        attachments: openingAttachments.length > 0 ? openingAttachments : null,
      })
    }
    return ticket
  })

  log.info({ ticket_id: created.id, type: created.type }, 'ticket created')
  void emitTicketCreated(actor, created, {
    category: defaultStatus.category,
    stage: resolveStage(defaultStatus),
  })
  // Realtime signal (unified inbox §3.2, M3): a fresh ticket is a new inbox
  // row, so the same 'ticket_updated' kind the update paths use below also
  // covers creation, mirroring how the conversation domain's 'conversation'
  // event has no separate created/updated split.
  return publishTicketUpdated(created)
}

/** Open a ticket as an agent (any type, optional requester). */
export async function createTicket(input: CreateTicketInput, actor: Actor): Promise<TicketDTO> {
  assertCan(actor, PERMISSIONS.TICKET_CREATE, 'create a ticket')
  return createTicketCore(input, actor)
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
      .select({ category: ticketStatuses.category, publicStage: ticketStatuses.publicStage })
      .from(ticketStatuses)
      .where(and(eq(ticketStatuses.id, statusId), isNull(ticketStatuses.deletedAt)))
      .limit(1),
    db
      .select({ category: ticketStatuses.category, publicStage: ticketStatuses.publicStage })
      .from(ticketStatuses)
      .where(eq(ticketStatuses.id, existing.statusId))
      .limit(1),
  ])
  if (!target) throw new NotFoundError('STATUS_NOT_FOUND', `Ticket status ${statusId} not found`)

  const now = new Date()
  const transition = statusTransition(current?.category ?? 'open', target.category, now)
  const patch: Partial<Ticket> = { statusId, updatedAt: now }
  if (transition.resolvedAt !== undefined) patch.resolvedAt = transition.resolvedAt
  if (transition.reopenedIncrement) {
    patch.reopenedCount = sql`${tickets.reopenedCount} + 1` as unknown as number
  }
  const stamp = firstResponseStamp(existing.firstResponseAt, isTeamMember(actor.role), now)
  if (stamp) patch.firstResponseAt = stamp

  const [updated] = await db.update(tickets).set(patch).where(eq(tickets.id, id)).returning()

  // Realtime signal (unified inbox §3.2, M3), unconditional like the webhook
  // below — mirrors conversation.service's publish-right-after-the-UPDATE
  // pattern. Computed once and reused for the function's return value.
  const dto = await publishTicketUpdated(updated)

  // Agent/integration-facing signal: every internal status move fires a hook
  // (mirrors conversation.status_changed), reporting the category axis.
  void emitTicketStatusChanged(
    actor,
    updated,
    current?.category ?? 'open',
    target.category,
    resolveStage(target)
  )

  // A public_stage crossing to a visible stage is the single customer-facing
  // signal (§4.2): post a status event into the ticket thread. Null-stage and
  // same-stage churn stay silent (customers hear stage progress, not internal
  // churn). The requester bell/email + conversation echo ride this same crossing
  // in a later slice.
  const newStage = resolveStage(target)
  const oldStage = current ? resolveStage(current) : null
  if (newStage && newStage !== oldStage) {
    const stageLabels = await getStageLabels()
    const stageLabel = stageLabels[newStage]
    await postTicketStatusEvent(id, stageLabel)
    // Notify the requester's bell that their ticket progressed. The system-1
    // email (§4.8) and the conversation echo ride this same crossing later.
    if (existing.requesterPrincipalId) {
      const body = oldStage
        ? `Moved from ${stageLabels[oldStage]} to ${stageLabel}`
        : 'Open the ticket to see the latest update.'
      await createNotification({
        principalId: existing.requesterPrincipalId,
        type: 'ticket_status_changed',
        title: `${updated.title} is now ${stageLabel}`,
        body,
        metadata: { ticketId: id },
      })
    }

    // A tracker fans its stage progress onto the customer tickets it tracks
    // (§4.9): each linked ticket takes the tracker's status and runs its own
    // crossing (its requester's bell + thread event). Trackers carry no
    // requester of their own, so the bell above never fires for them.
    if (existing.type === 'tracker') {
      await cascadeTrackerStatus(id, statusId, actor)
    }
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
 *  internal status name — only the public stage label). */
async function postTicketStatusEvent(ticketId: TicketId, stageLabel: string): Promise<void> {
  await db.insert(conversationMessages).values({
    ticketId,
    principalId: null,
    senderType: 'system',
    content: `Status updated to ${stageLabel}`,
    metadata: { systemEvent: { kind: 'ticket_status_changed', stageLabel } },
  })
}

/**
 * A requester reply reopens a ticket that was awaiting them or closed (§4.2, the
 * ticket-axis analogue of conversation reopen): from an `awaiting_requester`-
 * projecting status OR a `closed` category, move to the first open-category status
 * (clearing resolved_at + counting the reopen when leaving closed). No-op
 * otherwise. No permission check — the trigger is a requester reply on their own
 * ticket, verified upstream. Returns whether it moved.
 */
export async function autoReopenOnRequesterReply(id: TicketId): Promise<boolean> {
  const existing = await loadTicketOr404(id)
  const [current] = await db
    .select({ category: ticketStatuses.category, publicStage: ticketStatuses.publicStage })
    .from(ticketStatuses)
    .where(eq(ticketStatuses.id, existing.statusId))
    .limit(1)
  if (!current) return false
  const awaiting = resolveStage(current) === 'awaiting_requester'
  if (!awaiting && current.category !== 'closed') return false

  const [firstOpen] = await db
    .select({ id: ticketStatuses.id })
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
  await db.update(tickets).set(patch).where(eq(tickets.id, id))
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
    void emitTicketAssigned(
      actor,
      updated,
      existing.assigneePrincipalId ?? null,
      existing.assigneeTeamId ?? null
    )
  }
  return dto
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
  // Realtime signal (unified inbox §3.2, M3).
  return publishTicketUpdated(updated)
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
    // Realtime signal (unified inbox §3.2, M3): the list re-query already
    // excludes a deleted ticket via ticketFilter, so the refetch this triggers
    // is what actually makes the row disappear for every other viewer.
    await publishTicketUpdated(updated)
  }
}
