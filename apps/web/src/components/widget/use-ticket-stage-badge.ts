import { useEffect, useMemo, useReducer } from 'react'
import { useQuery } from '@tanstack/react-query'
import { widgetGetMyTicketsFn } from '@/lib/server/functions/widget/tickets'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'
import { widgetMyTicketsKey } from './widget-tickets'
import {
  countTicketStageChanges,
  getTicketStagesSeen,
  markTicketStagesSeen,
  touchTicketStagesSeen,
  TICKET_STAGES_SEEN_EVENT,
} from './ticket-stage-seen'
import { seenScope } from './seen-scope'

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
  const { sessionVersion, isIdentified, identityResolved, user } = useWidgetAuth()
  // Null until the identity round trip settles: no marker is read or written
  // for a visitor the widget cannot yet tell apart, and the badge stays 0.
  const scope = seenScope(user, identityResolved)
  const { data, isError } = useQuery({
    queryKey: widgetMyTicketsKey(sessionVersion),
    queryFn: () => widgetGetMyTicketsFn({ headers: getWidgetAuthHeaders() }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: enabled && isIdentified,
  })

  // Re-read the markers whenever the Tickets tab advances them (same-tab
  // updates don't fire the native `storage` event, hence the custom one).
  const [markersVersion, reread] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    window.addEventListener(TICKET_STAGES_SEEN_EVENT, reread)
    return () => window.removeEventListener(TICKET_STAGES_SEEN_EVENT, reread)
  }, [])
  // Widget tickets are identified-only: an anonymous scope has no markers.
  const counts = scope !== null && isIdentified
  // Read and parsed once per person and per marker change, not every render.
  const seen = useMemo(
    () => (counts ? getTicketStagesSeen(scope) : null),
    // markersVersion is the re-read trigger: storage is not React state.
    [counts, scope, markersVersion]
  )

  const tickets = data?.tickets ?? []

  // Showing the badge counts as activity, so a person whose map has nothing
  // new to record keeps it on a browser shared by many (see seen-scope.ts).
  useEffect(() => {
    if (counts) touchTicketStagesSeen(scope)
  }, [counts, scope])

  // Silent first-contact baseline: stamp the stages current at the first
  // load so historical states never badge (see ticket-stage-seen.ts).
  useEffect(() => {
    // Widget tickets are identified-only: an anonymous visitor never stamps.
    if (!counts || !data) return
    if (getTicketStagesSeen(scope) === null) markTicketStagesSeen(scope, data.tickets)
  }, [data, scope, counts])

  return {
    unread: counts ? countTicketStageChanges(tickets, seen) : 0,
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
