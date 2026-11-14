/**
 * Whether OTHER teammates can see a ticket, for the paths that act on someone
 * besides the caller: fanning a ticket's bells and emails out to its watchers
 * (and, with the watchers feature, adding a watcher and the watcher picker).
 * `assertTicketVisible` answers the same question for the caller, one query
 * per ticket; here it is answered for a whole set of people at once, with
 * `canViewTicket` (the in-memory twin of `ticketFilter`) over one read of their
 * roles, their resolved permissions and the ticket team's members
 * (`teammateView`, notifications/recipient-scope.ts).
 *
 * Only teammates are judged. A customer's access to a ticket is ownership (the
 * requester), checked where they act, so a non-team principal passes through
 * untouched: this never drops the requester from their own ticket's fan-out.
 */
import type { PrincipalId, TicketId } from '@quackback/ids'
import { teammateView, type TeammateView } from '@/lib/server/domains/notifications/recipient-scope'

export type TeammateTicketView = TeammateView

/**
 * Split `principalIds` by whether each teammate can see the ticket. A deleted
 * or missing ticket is hidden from every teammate.
 */
export function teammateTicketView(
  ticketId: TicketId,
  principalIds: readonly PrincipalId[]
): Promise<TeammateTicketView> {
  return teammateView({ kind: 'ticket', id: ticketId }, principalIds)
}

/**
 * `principalIds` minus the teammates who cannot see the ticket, order kept.
 * The fan-out filter: a watcher who lost sight of a ticket (reassigned away
 * from them and their team) stops hearing about it, without losing the row,
 * so the watch resumes if the ticket comes back to them.
 */
export async function withoutTeammatesWhoCannotSee(
  ticketId: TicketId,
  principalIds: readonly PrincipalId[]
): Promise<PrincipalId[]> {
  if (principalIds.length === 0) return []
  const { hidden } = await teammateTicketView(ticketId, principalIds)
  return principalIds.filter((id) => !hidden.has(id))
}
