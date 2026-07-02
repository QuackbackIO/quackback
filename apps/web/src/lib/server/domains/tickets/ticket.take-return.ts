/**
 * Take/return convenience helpers — wrap assignTicket so the caller doesn't
 * need to know the current updatedAt or fiddle with assignee fields.
 */
import { NotFoundError } from '@/lib/shared/errors'
import type { TicketId, PrincipalId } from '@quackback/ids'
import { assignTicket, getTicket } from './ticket.service'
import type { Ticket } from '@/lib/server/db'

export async function takeTicket(
  ticketId: TicketId,
  actorPrincipalId: PrincipalId
): Promise<Ticket> {
  const existing = await getTicket(ticketId)
  if (!existing) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  return assignTicket(ticketId, {
    expectedUpdatedAt: existing.updatedAt,
    actorPrincipalId,
    assigneePrincipalId: actorPrincipalId,
  })
}

export async function returnTicket(
  ticketId: TicketId,
  actorPrincipalId: PrincipalId
): Promise<Ticket> {
  const existing = await getTicket(ticketId)
  if (!existing) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  return assignTicket(ticketId, {
    expectedUpdatedAt: existing.updatedAt,
    actorPrincipalId,
    assigneePrincipalId: null,
  })
}
