import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { TicketIcon } from '@heroicons/react/24/solid'
import { getMyTicketsFn } from '@/lib/server/functions/tickets'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StageChip } from '@/components/shared/ticket-stage'

/**
 * The Tickets tab — the signed-in requester's own tickets, newest-activity
 * first, each row carrying its current public stage chip and reference. Rows
 * are read-only here: the conversation the ticket is paired with lives on the
 * Messages tab, so this list is the status-at-a-glance surface, not a second
 * inbox. Identified visitors only — an anonymous visitor has no tickets, so
 * the tab itself is gated on sign-in upstream.
 */
export function WidgetTickets() {
  const { sessionVersion } = useWidgetAuth()
  const { data, isLoading } = useQuery({
    // Re-keyed on sessionVersion so the list refreshes after identify.
    queryKey: ['widget', 'myTickets', sessionVersion],
    // Forward the widget Bearer token — the requester scope is the token.
    queryFn: () => getMyTicketsFn({ headers: getWidgetAuthHeaders() }),
    staleTime: 30_000,
  })

  const tickets = data?.tickets ?? []

  return (
    <div className="relative flex h-full flex-col">
      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
        {tickets.length > 0 ? (
          <ul className="px-3 pt-1 pb-24">
            {tickets.map((t) => (
              <li key={t.ticketId} className="border-b border-border/40 last:border-b-0">
                <div className="flex w-full items-center gap-3 rounded-lg px-2 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {t.title}
                      </span>
                      <TimeAgo
                        date={t.updatedAt}
                        className="shrink-0 text-[11px] text-muted-foreground/60"
                      />
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
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
                </div>
              </li>
            ))}
          </ul>
        ) : (
          !isLoading && (
            <div className="flex h-full flex-col items-center justify-center px-6 pt-16 pb-24 text-center">
              <TicketIcon className="mb-2 w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground/70">
                <FormattedMessage id="widget.tickets.empty" defaultMessage="No tickets yet" />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/50">
                <FormattedMessage
                  id="widget.tickets.emptyHint"
                  defaultMessage="When the team opens a ticket for you, it shows up here."
                />
              </p>
            </div>
          )
        )}
      </ScrollArea>
    </div>
  )
}
