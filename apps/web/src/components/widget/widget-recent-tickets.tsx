import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import type { ConversationId } from '@quackback/ids'
import { getMyTicketsFn } from '@/lib/server/functions/tickets'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'
import { widgetMyTicketsKey } from './widget-tickets'
import { TimeAgo } from '@/components/ui/time-ago'
import { StageChip } from '@/components/shared/ticket-stage'

/** How many tickets the Home card lists — a glanceable recency strip, not the
 *  full index (that is the Tickets tab). */
const RECENT_TICKETS_LIMIT = 3

/**
 * The Home surface's Recent tickets card: up to three of the identified
 * requester's own tickets, newest-activity first, each row showing its public
 * stage chip and opening its conversation thread (the converged pair) on tap.
 * Shares the Tickets tab's query key so the two surfaces never fetch twice.
 * Renders nothing for an anonymous visitor (no tickets exist) or when the
 * requester has none.
 */
export function WidgetRecentTicketsCard({
  onOpenTicket,
}: {
  /** Opens the pair's conversation thread for a tapped row. */
  onOpenTicket: (conversationId: ConversationId) => void
}) {
  const { sessionVersion, isIdentified } = useWidgetAuth()
  const { data } = useQuery({
    queryKey: widgetMyTicketsKey(sessionVersion),
    queryFn: () => getMyTicketsFn({ headers: getWidgetAuthHeaders() }),
    staleTime: 30_000,
    // Anonymous visitors have no requester scope; the fn would 403.
    enabled: isIdentified,
  })

  const tickets = (data?.tickets ?? []).slice(0, RECENT_TICKETS_LIMIT)
  if (tickets.length === 0) return null

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3">
      <p className="mb-1 text-sm font-semibold text-foreground">
        <FormattedMessage id="widget.tickets.recent" defaultMessage="Recent tickets" />
      </p>
      <ul>
        {tickets.map((t) => (
          <li key={t.ticketId}>
            <button
              type="button"
              disabled={!t.conversationId}
              onClick={() => t.conversationId && onOpenTicket(t.conversationId)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start transition-colors hover:bg-accent disabled:hover:bg-transparent"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{t.title}</span>
                  <TimeAgo
                    date={t.updatedAt}
                    className="shrink-0 text-[11px] text-muted-foreground/60"
                  />
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <StageChip
                    slot={t.stage.slot}
                    label={t.stage.label}
                    closed={t.stage.closed}
                    closedLabelId="portal.tickets.stage.closed"
                  />
                  <span className="font-mono text-[11px] text-muted-foreground/60">
                    {t.reference}
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
