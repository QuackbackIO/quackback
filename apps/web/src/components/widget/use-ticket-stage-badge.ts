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
export function useTicketStageBadge(enabled: boolean): { unread: number; hasTickets: boolean } {
  const { sessionVersion, isIdentified } = useWidgetAuth()
  const { data } = useQuery({
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
    // Unknown/loading counts as none so the Tickets tab never flashes empty.
    hasTickets: isIdentified && tickets.length > 0,
  }
}
