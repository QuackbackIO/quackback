/**
 * Ticket bulk operations — best-effort partial-success.
 *
 * Each per-ticket op runs independently with its own optimistic-concurrency
 * check (assignTicket/transitionStatus). Failures are collected and returned
 * so callers can surface partial success without aborting the batch.
 *
 * Permission checks are the caller's responsibility — pass them in via the
 * `permit` callback (called once per ticket scope) so we can short-circuit
 * before mutating.
 */
import { db, eq, and, isNull, inArray, tickets, type Ticket } from '@/lib/server/db'
import type { TicketId, TicketStatusId, PrincipalId, TeamId, InboxId } from '@quackback/ids'
import { assignTicket, transitionStatus, toResourceScope } from './'
import { listSharesForTicket } from './ticket.share'
import { recordEvent } from '../audit'
import type { ResourceScope } from '../authz/authz.scopes'

export interface BulkSuccess {
  ticketId: TicketId
}
export interface BulkFailure {
  ticketId: TicketId
  reason: string
}
export interface BulkResult {
  succeeded: BulkSuccess[]
  failed: BulkFailure[]
}

async function loadTicketsForBulk(ticketIds: readonly TicketId[]): Promise<Ticket[]> {
  if (ticketIds.length === 0) return []
  return db
    .select()
    .from(tickets)
    .where(and(inArray(tickets.id, ticketIds as TicketId[]), isNull(tickets.deletedAt)))
}

async function permitFor(
  ticket: Ticket,
  permit: (scope: ResourceScope) => boolean
): Promise<boolean> {
  const shares = await listSharesForTicket(ticket.id as TicketId)
  return permit(
    toResourceScope({
      primaryTeamId: ticket.primaryTeamId as TeamId | null,
      assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
      assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
      shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
    })
  )
}

export interface BulkAssignInput {
  ticketIds: TicketId[]
  actorPrincipalId: PrincipalId
  assigneePrincipalId?: PrincipalId | null
  assigneeTeamId?: TeamId | null
  permit: (scope: ResourceScope) => boolean
}

export async function bulkAssign(input: BulkAssignInput): Promise<BulkResult> {
  const result: BulkResult = { succeeded: [], failed: [] }
  const rows = await loadTicketsForBulk(input.ticketIds)
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const ticketId of input.ticketIds) {
    const t = byId.get(ticketId)
    if (!t) {
      result.failed.push({ ticketId, reason: 'TICKET_NOT_FOUND' })
      continue
    }
    if (!(await permitFor(t, input.permit))) {
      result.failed.push({ ticketId, reason: 'FORBIDDEN' })
      continue
    }
    try {
      await assignTicket(ticketId, {
        expectedUpdatedAt: t.updatedAt,
        actorPrincipalId: input.actorPrincipalId,
        assigneePrincipalId: input.assigneePrincipalId,
        assigneeTeamId: input.assigneeTeamId,
      })
      result.succeeded.push({ ticketId })
    } catch (err) {
      result.failed.push({ ticketId, reason: errReason(err) })
    }
  }
  return result
}

export interface BulkTransitionInput {
  ticketIds: TicketId[]
  actorPrincipalId: PrincipalId
  statusId: TicketStatusId
  permit: (scope: ResourceScope) => boolean
}

export async function bulkTransition(input: BulkTransitionInput): Promise<BulkResult> {
  const result: BulkResult = { succeeded: [], failed: [] }
  const rows = await loadTicketsForBulk(input.ticketIds)
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const ticketId of input.ticketIds) {
    const t = byId.get(ticketId)
    if (!t) {
      result.failed.push({ ticketId, reason: 'TICKET_NOT_FOUND' })
      continue
    }
    if (!(await permitFor(t, input.permit))) {
      result.failed.push({ ticketId, reason: 'FORBIDDEN' })
      continue
    }
    try {
      await transitionStatus(ticketId, {
        expectedUpdatedAt: t.updatedAt,
        actorPrincipalId: input.actorPrincipalId,
        statusId: input.statusId,
      })
      result.succeeded.push({ ticketId })
    } catch (err) {
      result.failed.push({ ticketId, reason: errReason(err) })
    }
  }
  return result
}

export interface BulkChangeInboxInput {
  ticketIds: TicketId[]
  actorPrincipalId: PrincipalId
  inboxId: InboxId | null
  permit: (scope: ResourceScope) => boolean
}

export async function bulkChangeInbox(input: BulkChangeInboxInput): Promise<BulkResult> {
  const result: BulkResult = { succeeded: [], failed: [] }
  const rows = await loadTicketsForBulk(input.ticketIds)
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const ticketId of input.ticketIds) {
    const t = byId.get(ticketId)
    if (!t) {
      result.failed.push({ ticketId, reason: 'TICKET_NOT_FOUND' })
      continue
    }
    if (!(await permitFor(t, input.permit))) {
      result.failed.push({ ticketId, reason: 'FORBIDDEN' })
      continue
    }
    try {
      const [updated] = await db
        .update(tickets)
        .set({ inboxId: input.inboxId, lastActivityAt: new Date() })
        .where(and(eq(tickets.id, ticketId), eq(tickets.updatedAt, t.updatedAt)))
        .returning()
      if (!updated) {
        result.failed.push({ ticketId, reason: 'TICKET_STALE' })
        continue
      }
      void recordEvent({
        principalId: input.actorPrincipalId,
        action: 'ticket.inbox_changed',
        targetType: 'ticket',
        targetId: ticketId,
        diff: { before: { inboxId: t.inboxId }, after: { inboxId: input.inboxId } },
      })
      try {
        const { dispatchTicketUpdated, buildEventActor } =
          await import('@/lib/server/events/dispatch')
        const actor = input.actorPrincipalId
          ? buildEventActor({
              principalId: input.actorPrincipalId,
              displayName: 'ticket-system',
            })
          : { type: 'service' as const, displayName: 'ticket-system' }
        await dispatchTicketUpdated(
          actor,
          updated as unknown as Record<string, unknown>,
          ['inboxId'],
          { inboxId: { from: t.inboxId, to: input.inboxId } }
        )
      } catch (err) {
        console.warn('[tickets] dispatchTicketUpdated (bulkChangeInbox) failed', err)
      }
      result.succeeded.push({ ticketId })
    } catch (err) {
      result.failed.push({ ticketId, reason: errReason(err) })
    }
  }
  return result
}

function errReason(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string')
    return err.code
  if (err instanceof Error) return err.message
  return 'UNKNOWN'
}
