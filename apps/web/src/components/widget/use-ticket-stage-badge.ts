import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMyTicketsFn } from '@/lib/server/functions/tickets'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'
import { widgetMyTicketsKey } from './widget-tickets'
import {
  countTicketStageChanges,
  getTicketStagesSeen,
  markTicketStagesSeen,
  TICKET_STAGES_SEEN_EVENT,
} from './ticket-stage-seen'

/**
 * Whether this visitor has any tickets: `true`/`false` once known, `null`
 * while the answer is still pending (identity not yet resolved, or the
 * identified visitor's list still loading). Callers must not read `null` as
 * "none" — see widget-nav's `visibleTabsForVisitor`.
 */
export type HasTickets = boolean | null

/**
 * Count of the requester's tickets whose public stage moved since they last
 * opened the Tickets tab — badges the launcher until then. Pass
 * `enabled=false` (tickets tab off) to skip the fetch. Shares the Tickets
 * tab's query key so the badge and the two ticket surfaces read one cache.
 * Polls so a stage moved while the host page sits open badges without a
 * reload. Anonymous visitors skip the fetch (no requester scope).
 *
 * First contact stamps a silent baseline: stages current at the first load
 * never badge; only later moves do (see ticket-stage-seen.ts).
 */
export function useTicketStageBadge(enabled: boolean): { unread: number; hasTickets: HasTickets } {
  const { sessionVersion, isIdentified, identityResolved } = useWidgetAuth()
  const { data, isError } = useQuery({
    queryKey: widgetMyTicketsKey(sessionVersion),
    queryFn: () => getMyTicketsFn({ headers: getWidgetAuthHeaders() }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: enabled && isIdentified,
  })

  // Re-read the markers whenever the Tickets tab advances them (same-tab
  // updates don't fire the native `storage` event, hence the custom one).
  const [seen, setSeen] = useState(() => getTicketStagesSeen())
  useEffect(() => {
    const onSeen = () => setSeen(getTicketStagesSeen())
    window.addEventListener(TICKET_STAGES_SEEN_EVENT, onSeen)
    return () => window.removeEventListener(TICKET_STAGES_SEEN_EVENT, onSeen)
  }, [])

  const tickets = data?.tickets ?? []

  // Silent first-contact baseline: stamp the stages current at the first
  // load so historical states never badge (see ticket-stage-seen.ts).
  useEffect(() => {
    if (data && getTicketStagesSeen() === null) markTicketStagesSeen(data.tickets)
  }, [data])

  return {
    unread: countTicketStageChanges(tickets, seen),
    hasTickets: resolveHasTickets({ enabled, identityResolved, isIdentified, data, isError }),
  }
}

/**
 * Pure projection of the hook's inputs onto the tri-state. Unknown is
 * reported (not collapsed to "none") whenever the answer is still pending:
 * the widget must not reshape its bar on a provisional reading, then fail to
 * restore it when the real one arrives. Widget tickets are identified-only,
 * so a resolved anonymous visitor is a definite "none". A failed load also
 * settles as "none" — the tab is hidden rather than shown empty.
 */
export function resolveHasTickets(input: {
  enabled: boolean
  identityResolved: boolean
  isIdentified: boolean
  data: { tickets: ReadonlyArray<unknown> } | undefined
  isError: boolean
}): HasTickets {
  if (!input.enabled) return false
  if (!input.identityResolved) return null
  if (!input.isIdentified) return false
  if (input.data === undefined) return input.isError ? false : null
  return input.data.tickets.length > 0
}
