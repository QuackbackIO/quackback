import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { TicketIcon, PlusIcon } from '@heroicons/react/24/solid'
import type { ConversationId } from '@quackback/ids'
import { getMyTicketsFn } from '@/lib/server/functions/tickets'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StageChip } from '@/components/shared/ticket-stage'
import { WidgetTicketNew } from './widget-ticket-new'

/** The own-tickets list query key (shared with the New-Ticket form's invalidation). */
export function widgetMyTicketsKey(sessionVersion: number) {
  return ['widget', 'myTickets', sessionVersion] as const
}

/**
 * The Tickets tab — the signed-in requester's own tickets, newest-activity
 * first, each row carrying its current public stage chip and reference. A row
 * opens its ticket's conversation thread (the converged pair) via
 * `onOpenTicket`; a legacy pair-less row stays inert. The "New ticket"
 * affordance swaps the list for the intake form; a submitted ticket lands at
 * the top of the list. Identified visitors only — an anonymous visitor has
 * no tickets, so the tab itself is gated on sign-in upstream.
 */
export function WidgetTickets({
  onOpenTicket,
}: {
  /** Opens the pair's conversation thread for a tapped row. */
  onOpenTicket: (conversationId: ConversationId) => void
}) {
  const { sessionVersion } = useWidgetAuth()
  const [composing, setComposing] = useState(false)
  const { data, isLoading } = useQuery({
    // Re-keyed on sessionVersion so the list refreshes after identify.
    queryKey: widgetMyTicketsKey(sessionVersion),
    // Forward the widget Bearer token — the requester scope is the token.
    queryFn: () => getMyTicketsFn({ headers: getWidgetAuthHeaders() }),
    staleTime: 30_000,
  })

  const tickets = data?.tickets ?? []

  if (composing) {
    return (
      <WidgetTicketNew onCreated={() => setComposing(false)} onCancel={() => setComposing(false)} />
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end px-3 pt-2">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <PlusIcon className="size-3.5" />
          <FormattedMessage id="widget.tickets.new" defaultMessage="New ticket" />
        </button>
      </div>
      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
        {tickets.length > 0 ? (
          <ul className="px-3 pt-1 pb-24">
            {tickets.map((t) => (
              <li key={t.ticketId} className="border-b border-border/40 last:border-b-0">
                <button
                  type="button"
                  disabled={!t.conversationId}
                  onClick={() => t.conversationId && onOpenTicket(t.conversationId)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-start transition-colors hover:bg-muted/40 disabled:hover:bg-transparent"
                >
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
                </button>
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
                  defaultMessage="Open a ticket and we'll track it for you."
                />
              </p>
            </div>
          )
        )}
      </ScrollArea>
    </div>
  )
}
