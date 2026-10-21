/**
 * Which tickets open an issue on their own. A destination (a GitHub
 * repository) opts in with event mappings of its own: one for
 * `ticket.created` and one for `ticket.assigned` (a team set after the ticket
 * was opened can make it match), each routed to that destination and carrying
 * the same team and ticket-type filters. They are the destination's, not
 * copies of the connection's defaults, so mirroring the defaults leaves them
 * alone. A mapping's creation time is the opt-in: a ticket opened before it
 * never gets an issue this way.
 */
import type { EventMappingFilters } from '@/lib/server/db'

export const TICKET_ISSUE_EVENTS: readonly string[] = ['ticket.created', 'ticket.assigned']

export function isTicketIssueEvent(type: string): boolean {
  return TICKET_ISSUE_EVENTS.includes(type)
}

/** A ticket as the filters see it. */
export interface TicketScopeFacts {
  teamId?: string | null
  ticketTypeId?: string | null
}

/**
 * Whether a ticket falls inside a mapping's ticket filters. An empty or
 * absent list lets every value through; a ticket without a team or type does
 * not match a list that names some.
 */
export function ticketMatchesFilters(
  filters: EventMappingFilters | null | undefined,
  ticket: TicketScopeFacts
): boolean {
  const teams = filters?.ticketTeamIds
  const types = filters?.ticketTypeIds
  if (teams?.length && !(ticket.teamId && teams.includes(ticket.teamId))) return false
  if (types?.length && !(ticket.ticketTypeId && types.includes(ticket.ticketTypeId))) return false
  return true
}

/** Whether a mapping filters on tickets at all (and so cannot match anything else). */
export function hasTicketFilters(filters: EventMappingFilters | null | undefined): boolean {
  return !!(filters?.ticketTeamIds?.length || filters?.ticketTypeIds?.length)
}
