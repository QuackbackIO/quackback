/**
 * Whether OTHER teammates can see a ticket, for the paths that act on someone
 * besides the caller: adding a teammate as a watcher, offering teammates in
 * the watcher picker, and fanning a ticket's bells and emails out to its
 * watchers. `assertTicketVisible` answers the same question for the caller,
 * one query per ticket; here it is answered for a whole set of people at once,
 * with `canViewTicket` (the in-memory twin of `ticketFilter`) over one read of
 * their roles, their resolved permissions and the ticket team's members.
 *
 * Only teammates are judged. A customer's access to a ticket is ownership (the
 * requester), checked where they act, so a non-team principal passes through
 * untouched: this never drops the requester from their own ticket's fan-out.
 */
import { db, eq, and, inArray, principal, teamMembers, tickets } from '@/lib/server/db'
import type { PrincipalId, TeamId, TicketId } from '@quackback/ids'
import { canViewTicket } from '@/lib/server/policy/tickets'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'
import { isTeamMember, type Role } from '@/lib/shared/roles'

export interface TeammateTicketView {
  /** Teammates among the input who can see the ticket. */
  visible: Set<PrincipalId>
  /** Teammates among the input who cannot. */
  hidden: Set<PrincipalId>
  /** Everyone else in the input (customers, service principals): not judged. */
  others: Set<PrincipalId>
}

/**
 * Split `principalIds` by whether each teammate can see the ticket. A deleted
 * or missing ticket is hidden from every teammate.
 */
export async function teammateTicketView(
  ticketId: TicketId,
  principalIds: readonly PrincipalId[]
): Promise<TeammateTicketView> {
  const view: TeammateTicketView = { visible: new Set(), hidden: new Set(), others: new Set() }
  const ids = [...new Set(principalIds)]
  if (ids.length === 0) return view

  const [ticket] = await db
    .select({
      assigneePrincipalId: tickets.assigneePrincipalId,
      assigneeTeamId: tickets.assigneeTeamId,
      deletedAt: tickets.deletedAt,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1)

  const people = await db
    .select({ id: principal.id, type: principal.type, role: principal.role })
    .from(principal)
    .where(inArray(principal.id, ids))
  const teammates = people.filter((p) => p.type === 'user' && isTeamMember(p.role))
  const teammateIds = new Set(teammates.map((p) => p.id))
  for (const id of ids) if (!teammateIds.has(id)) view.others.add(id)
  if (teammates.length === 0) return view
  if (!ticket) {
    for (const p of teammates) view.hidden.add(p.id)
    return view
  }

  // The ticket's one team is the only membership canViewTicket can ever need.
  const onTicketTeam = new Set<PrincipalId>()
  if (ticket.assigneeTeamId) {
    const rows = await db
      .select({ principalId: teamMembers.principalId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, ticket.assigneeTeamId as TeamId),
          inArray(teamMembers.principalId, [...teammateIds])
        )
      )
    for (const row of rows) onTicketTeam.add(row.principalId)
  }

  await Promise.all(
    teammates.map(async (p) => {
      const role = p.role as Role
      const actor: Actor = {
        principalId: p.id,
        role,
        principalType: 'user',
        segmentIds: new Set(),
        permissions: await permissionsForPrincipal(p.id, role),
      }
      const teamIds = new Set<TeamId>(
        onTicketTeam.has(p.id) && ticket.assigneeTeamId ? [ticket.assigneeTeamId as TeamId] : []
      )
      const decision = canViewTicket(actor, ticket, teamIds)
      ;(decision.allowed ? view.visible : view.hidden).add(p.id)
    })
  )
  return view
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
