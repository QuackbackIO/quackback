/**
 * Whether OTHER teammates can see a ticket, for the paths that act on someone
 * besides the caller: fanning a ticket's bells and emails out to its watchers
 * (and, with the watchers feature, adding a watcher and the watcher picker).
 * `assertTicketVisible` answers the same question for the caller, one query
 * per ticket; here it is answered for a whole set of people at once, by the
 * recipient rule every notice uses (notifications/recipient-scope.ts):
 * `canViewTicket` over one read of their roles, their resolved permissions
 * and the ticket team's members.
 *
 * A customer's access to a ticket is ownership, so the ticket's requester
 * passes when the caller names them; anyone else who is not a teammate is
 * dropped.
 */
import type { PrincipalId, TicketId } from '@quackback/ids'
import {
  inScopeRecipients,
  teammateView,
  type Candidate,
  type TeammateView,
} from '@/lib/server/domains/notifications/recipient-scope'

export type TeammateTicketView = TeammateView

/**
 * Split the teammates among `principalIds` by whether each can see the
 * ticket. A deleted or missing ticket is hidden from every teammate.
 */
export function teammateTicketView(
  ticketId: TicketId,
  principalIds: readonly Candidate[]
): Promise<TeammateTicketView> {
  return teammateView({ kind: 'ticket', id: ticketId }, principalIds)
}

/**
 * `principalIds` cut to the teammates who can see the ticket, plus its
 * requester when named, order kept. The fan-out filter: a watcher who lost
 * sight of a ticket (reassigned away from them and their team) stops hearing
 * about it, without losing the row, so the watch resumes if the ticket comes
 * back to them.
 */
export function withoutTeammatesWhoCannotSee(
  ticketId: TicketId,
  principalIds: readonly Candidate[],
  opts: { requesterPrincipalId?: string | null } = {}
): Promise<PrincipalId[]> {
  return inScopeRecipients({ kind: 'ticket', id: ticketId }, principalIds, opts)
}
