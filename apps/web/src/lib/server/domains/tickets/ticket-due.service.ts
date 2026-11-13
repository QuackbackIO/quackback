/**
 * Ticket due dates: the ONE write path for `tickets.due_at` after creation.
 *
 * A ticket carries a single shared due date. The customer can propose it when
 * filing (validated in `createTicketCore`); after that a teammate, a workflow
 * action, the v1 API, MCP or a bulk apply sets, moves or clears it here, and
 * the customer sees the current value on their ticket. It is independent of
 * SLA targets, which live in `sla_applied` and have their own clock.
 *
 * Every caller funnels through `setTicketDueAt` so the permission check, the
 * window validation, the alert re-arming, the activity row, the
 * `ticket.due_changed` event and the realtime publish happen exactly once.
 */
import { db, eq, and, tickets, type Ticket } from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isTeamMember } from '@/lib/shared/roles'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { dueAlertMarkersOnSet } from '@/lib/shared/ticket-due'
import { firstResponseStamp } from './ticket.lifecycle'
import { recordTicketActivity } from './ticket-activity.service'
import { emitTicketDueChanged } from './ticket.webhooks'
import { publishTicketUpdated } from './ticket-intake.service'
import { ticketRowToDTO } from './ticket.dto'
import { assertTicketDueAt } from './ticket-due.rules'
import type { TicketDTO } from './ticket.types'

export { assertTicketDueAt }

export interface SetTicketDueOptions {
  /** Clock override for tests; defaults to now. */
  now?: Date
}

/** A non-deleted ticket the actor can see, or NotFound (never Forbidden, so
 *  an invisible ticket's existence does not leak). */
async function loadVisibleTicket(id: TicketId, actor: Actor): Promise<Ticket> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), ticketFilter(actor)))
    .limit(1)
  if (!row) throw new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
  return row
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b
  return a.getTime() === b.getTime()
}

/**
 * Set, move or clear (`null`) a ticket's due date. Gated on the same
 * `ticket.set_status` permission as priority. A no-op re-set writes nothing,
 * so a re-run workflow or bulk apply never bumps `updatedAt` (which drives the
 * "recent" sort). A real change re-arms the due-soon/overdue alerts, records
 * a `due.changed` activity row, fires `ticket.due_changed` and publishes the
 * realtime update.
 */
export async function setTicketDueAt(
  id: TicketId,
  dueAt: Date | null,
  actor: Actor,
  opts: SetTicketDueOptions = {}
): Promise<TicketDTO> {
  if (!can(actor, PERMISSIONS.TICKET_SET_STATUS)) {
    throw new ForbiddenError('FORBIDDEN', 'You cannot change this ticket due date')
  }
  const now = opts.now ?? new Date()
  if (dueAt) assertTicketDueAt(dueAt, 'team', now)

  const existing = await loadVisibleTicket(id, actor)
  if (sameInstant(existing.dueAt, dueAt)) return ticketRowToDTO(existing)

  const patch: Partial<Ticket> = {
    dueAt,
    updatedAt: now,
    ...dueAlertMarkersOnSet({
      dueAt,
      now,
      actorIsAssignee:
        !!actor.principalId && actor.principalId === (existing.assigneePrincipalId ?? null),
    }),
  }
  const stamp = firstResponseStamp(existing.firstResponseAt, isTeamMember(actor.role), now)
  if (stamp) patch.firstResponseAt = stamp
  const [updated] = await db.update(tickets).set(patch).where(eq(tickets.id, id)).returning()

  // Durable timeline record + the integration signal (both fire-and-forget).
  recordTicketActivity({
    ticketId: id,
    principalId: actor.principalId,
    type: 'due.changed',
    metadata: {
      from: existing.dueAt ? existing.dueAt.toISOString() : null,
      to: updated.dueAt ? updated.dueAt.toISOString() : null,
    },
  })
  void emitTicketDueChanged(actor, updated, existing.dueAt)

  // Realtime signal (unified inbox §3.2, M3).
  return publishTicketUpdated(updated)
}
