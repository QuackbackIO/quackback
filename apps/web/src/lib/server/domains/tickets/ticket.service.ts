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
  isNull,
  inArray,
  sql,
  asc,
  desc,
  tickets,
  ticketStatuses,
  conversationMessages,
  principal,
  type Ticket,
  type ConversationPriority,
} from '@/lib/server/db'
import { validateContent } from '@/lib/server/messages/message-core'
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
import { getStageLabels } from '../settings/settings.tickets'
import { createNotification } from '../notifications/notification.service'
import { emitTicketCreated, emitTicketStatusChanged, emitTicketAssigned } from './ticket.webhooks'
import { buildTicketContext, ticketToDTO, ticketRowToDTO } from './ticket.dto'
import { statusTransition, firstResponseStamp, resolveStage } from './ticket.lifecycle'
import type {
  CreateTicketInput,
  AssignTicketInput,
  TicketListFilter,
  TicketSort,
  TicketDTO,
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

export async function getTicket(id: TicketId): Promise<TicketDTO> {
  return ticketRowToDTO(await loadTicketOr404(id))
}

const priorityRankExpr = priorityRankSql(tickets.priority)

function orderByForTicketSort(sort: TicketSort): SQL[] {
  switch (sort) {
    case 'oldest':
      return [asc(tickets.updatedAt), asc(tickets.id)]
    case 'created':
      return [desc(tickets.createdAt), desc(tickets.id)]
    case 'priority':
      return [desc(priorityRankExpr), desc(tickets.updatedAt), desc(tickets.id)]
    case 'recent':
    default:
      return [desc(tickets.updatedAt), desc(tickets.id)]
  }
}

/**
 * List tickets for an agent, filtered + sorted, scoped by `ticketFilter(actor)`.
 * Soft-deleted tickets are excluded. Status-category and stage filters resolve
 * through subqueries on ticket_statuses so the outer select stays tickets-only.
 */
export async function listTickets(filter: TicketListFilter, actor: Actor): Promise<TicketDTO[]> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)

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

  const rows = await db
    .select()
    .from(tickets)
    .where(
      and(
        // ticketFilter(actor) already excludes soft-deleted rows in every branch.
        ticketFilter(actor),
        filter.type ? eq(tickets.type, filter.type) : undefined,
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
        filter.companyId ? eq(tickets.companyId, filter.companyId) : undefined
      )
    )
    .orderBy(...orderByForTicketSort(filter.sort ?? 'recent'))
    .limit(limit)

  const ctx = await buildTicketContext(rows)
  return rows.map((r) => ticketToDTO(r, ctx))
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

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

  const description = input.description?.trim()

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

    if (description) {
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
        content: validateContent(description),
      })
    }
    return ticket
  })

  log.info({ ticket_id: created.id, type: created.type }, 'ticket created')
  void emitTicketCreated(actor, created, {
    category: defaultStatus.category,
    stage: resolveStage(defaultStatus),
  })
  return ticketRowToDTO(created)
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
    const stageLabel = (await getStageLabels())[newStage]
    await postTicketStatusEvent(id, stageLabel)
    // Notify the requester's bell that their ticket progressed. The system-1
    // email (§4.8) and the conversation echo ride this same crossing later.
    if (existing.requesterPrincipalId) {
      await createNotification({
        principalId: existing.requesterPrincipalId,
        type: 'ticket_status_changed',
        title: `${updated.title} is now ${stageLabel}`,
        metadata: { ticketId: id },
      })
    }
  }

  return ticketRowToDTO(updated)
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
  return ticketRowToDTO(updated)
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
  return ticketRowToDTO(updated)
}

/**
 * Soft-delete a ticket. There is no dedicated delete permission in the
 * catalogue, so this gates on TICKET_SET_STATUS (the closest lifecycle verb).
 */
export async function softDeleteTicket(id: TicketId, actor: Actor): Promise<void> {
  assertCan(actor, PERMISSIONS.TICKET_SET_STATUS, 'delete this ticket')
  await loadTicketOr404(id)
  await db
    .update(tickets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
}
