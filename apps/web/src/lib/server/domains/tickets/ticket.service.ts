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
  principal,
  teams,
  companies,
  type Ticket,
  type TicketStatusEntity,
  type ConversationPriority,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { TicketId, TicketStatusId, PrincipalId, TeamId, CompanyId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { isTeamMember } from '@/lib/shared/roles'
import { getTeam } from '@/lib/server/domains/teams'
import { NotFoundError, ValidationError, ForbiddenError, InternalError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { formatTicketNumber, type TicketStageLabels } from '@/lib/shared/tickets'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'
import { priorityRankSql } from '@/lib/server/utils/priority-rank'
import { getStageLabels } from '../settings/settings.tickets'
import { statusTransition, firstResponseStamp, resolveStage } from './ticket.lifecycle'
import type {
  CreateTicketInput,
  AssignTicketInput,
  TicketListFilter,
  TicketSort,
  TicketDTO,
  TicketPrincipalRef,
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
// DTO context (batched lookups; no N+1)
// ---------------------------------------------------------------------------

interface TicketDTOContext {
  statuses: Map<TicketStatusId, TicketStatusEntity>
  principals: Map<PrincipalId, TicketPrincipalRef>
  teams: Map<TeamId, string>
  companies: Map<CompanyId, string>
  stageLabels: TicketStageLabels
}

function uniqueIds<T extends string>(ids: ReadonlyArray<T | null | undefined>): T[] {
  return [...new Set(ids.filter((id): id is T => !!id))]
}

/** Resolve every reference a page of tickets needs in one batch per table. */
export async function buildTicketContext(rows: Ticket[]): Promise<TicketDTOContext> {
  const statusIds = uniqueIds(rows.map((r) => r.statusId))
  const teamIds = uniqueIds(rows.map((r) => r.assigneeTeamId))
  const companyIds = uniqueIds(rows.map((r) => r.companyId))

  const [statusRows, principals, teamRows, companyRows, stageLabels] = await Promise.all([
    statusIds.length
      ? db.select().from(ticketStatuses).where(inArray(ticketStatuses.id, statusIds))
      : Promise.resolve([] as TicketStatusEntity[]),
    // Reuse the inbox's principal loader so the avatar-precedence rule
    // (user.image → uploaded key → principal copy) stays in one place.
    loadAuthors([
      ...rows.map((r) => r.requesterPrincipalId),
      ...rows.map((r) => r.assigneePrincipalId),
    ]),
    teamIds.length
      ? db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds))
      : Promise.resolve([] as Array<{ id: TeamId; name: string }>),
    companyIds.length
      ? db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(inArray(companies.id, companyIds))
      : Promise.resolve([] as Array<{ id: CompanyId; name: string }>),
    getStageLabels(),
  ])

  return {
    statuses: new Map(statusRows.map((s) => [s.id, s])),
    principals,
    teams: new Map(teamRows.map((t) => [t.id, t.name])),
    companies: new Map(companyRows.map((c) => [c.id, c.name])),
    stageLabels,
  }
}

/** Map a ticket row + a resolved context to its wire DTO. */
export function ticketToDTO(row: Ticket, ctx: TicketDTOContext): TicketDTO {
  const status = ctx.statuses.get(row.statusId)
  const slot = status ? resolveStage(status) : null
  const requester = row.requesterPrincipalId
    ? (ctx.principals.get(row.requesterPrincipalId) ?? fallbackAuthor(row.requesterPrincipalId))
    : null
  const assignee = row.assigneePrincipalId
    ? (ctx.principals.get(row.assigneePrincipalId) ?? fallbackAuthor(row.assigneePrincipalId))
    : null

  return {
    id: row.id,
    number: row.number,
    reference: formatTicketNumber(row.number),
    type: row.type,
    title: row.title,
    status: status
      ? { id: status.id, name: status.name, color: status.color, category: status.category }
      : { id: row.statusId, name: 'Unknown', color: '#6b7280', category: 'open' },
    stage: { slot, label: slot ? ctx.stageLabels[slot] : null },
    priority: row.priority,
    requester: requester
      ? {
          principalId: requester.principalId,
          displayName: requester.displayName,
          avatarUrl: requester.avatarUrl,
        }
      : null,
    assignee: {
      principalId: row.assigneePrincipalId ?? null,
      displayName: assignee?.displayName ?? null,
      teamId: row.assigneeTeamId ?? null,
      teamName: row.assigneeTeamId ? (ctx.teams.get(row.assigneeTeamId) ?? null) : null,
    },
    company: row.companyId
      ? { id: row.companyId, name: ctx.companies.get(row.companyId) ?? 'Unknown' }
      : null,
    firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reopenedCount: row.reopenedCount,
  }
}

/** Load + map a single ticket row (used by the write paths + getTicket). */
async function ticketRowToDTO(row: Ticket): Promise<TicketDTO> {
  return ticketToDTO(row, await buildTicketContext([row]))
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

/** Open a ticket. Resolves the default status; `number` auto-increments. */
export async function createTicket(input: CreateTicketInput, actor: Actor): Promise<TicketDTO> {
  assertCan(actor, PERMISSIONS.TICKET_CREATE, 'create a ticket')
  const title = input.title?.trim()
  if (!title) throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Title must be ${MAX_TITLE_LENGTH} characters or less`
    )
  }

  const [defaultStatus] = await db
    .select({ id: ticketStatuses.id })
    .from(ticketStatuses)
    .where(and(eq(ticketStatuses.isDefault, true), isNull(ticketStatuses.deletedAt)))
    .limit(1)
  if (!defaultStatus) {
    throw new InternalError('NO_DEFAULT_STATUS', 'No default ticket status is configured')
  }

  const [created] = await db
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
  log.info({ ticket_id: created.id, type: created.type }, 'ticket created')
  return ticketRowToDTO(created)
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
      .select({ category: ticketStatuses.category })
      .from(ticketStatuses)
      .where(and(eq(ticketStatuses.id, statusId), isNull(ticketStatuses.deletedAt)))
      .limit(1),
    db
      .select({ category: ticketStatuses.category })
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
  return ticketRowToDTO(updated)
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
