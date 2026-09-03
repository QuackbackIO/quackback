import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { TicketIcon } from '@heroicons/react/24/solid'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import { getMyTicketsFn } from '@/lib/server/functions/tickets'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'
import {
  getTicketStagesSeen,
  markTicketStagesSeen,
  type TicketStageSeenMap,
} from './ticket-stage-seen'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StageChip } from '@/components/shared/ticket-stage'
import { cn } from '@/lib/shared/utils'
import { WidgetTicketListSkeleton } from './widget-skeletons'

/** The own-tickets list query key (shared with the Home recent-tickets card). */
export function widgetMyTicketsKey(sessionVersion: number) {
  return ['widget', 'myTickets', sessionVersion] as const
}

/**
 * The Tickets tab — the signed-in requester's own tickets, newest-activity
 * first, each row carrying its current public stage chip and reference. A row
 * opens its ticket's conversation thread (the converged pair) via
 * `onOpenTicket`; a legacy pair-less row stays inert. Visitors cannot file
 * tickets here — agents and email create them. Identified visitors only; an
 * anonymous visitor has no tickets, so the tab itself is gated on sign-in
 * upstream.
 */
export function WidgetTickets({
  onOpenTicket,
}: {
  /** Opens the pair's conversation thread for a tapped row. */
  onOpenTicket: (conversationId: ConversationId) => void
}) {
  const { sessionVersion } = useWidgetAuth()
  const { data, isLoading } = useQuery({
    // Re-keyed on sessionVersion so the list refreshes after identify.
    queryKey: widgetMyTicketsKey(sessionVersion),
    // Forward the widget Bearer token — the requester scope is the token.
    queryFn: () => getMyTicketsFn({ headers: getWidgetAuthHeaders() }),
    staleTime: 30_000,
  })

  const tickets = data?.tickets ?? []

  // The launcher/tab badge counts tickets whose stage moved since the visitor
  // last looked; the list should point at WHICH ones. Capture the seen map
  // once, when the list first has data — before the effect below advances it
  // — so the changed rows keep their marker for this visit.
  const baselineRef = useRef<TicketStageSeenMap | null | undefined>(undefined)
  if (data && baselineRef.current === undefined) baselineRef.current = getTicketStagesSeen()
  const changedIds = useMemo(() => {
    const seen = baselineRef.current
    if (!seen) return new Set<string>()
    return new Set(
      tickets
        .filter((t) => t.ticketId in seen && seen[t.ticketId] !== t.stage.slot)
        .map((t) => t.ticketId)
    )
  }, [tickets])

  // The Tickets tab IS the stage-seen surface: having the list on screen
  // advances the visitor's stage markers, clearing the launcher badge.
  useEffect(() => {
    if (data) markTicketStagesSeen(data.tickets)
  }, [data])

  return (
    <div className="relative flex h-full flex-col">
      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
        {isLoading ? (
          <WidgetTicketListSkeleton />
        ) : tickets.length > 0 ? (
          <ul className="px-3 pt-1 pb-3">
            {tickets.map((t) => {
              const openable = !!t.conversationId
              const changed = changedIds.has(t.ticketId)
              return (
                <li key={t.ticketId} className="border-b border-border/40 last:border-b-0">
                  <button
                    type="button"
                    disabled={!openable}
                    onClick={() => t.conversationId && onOpenTicket(t.conversationId)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2 py-3 text-start transition-colors',
                      openable ? 'hover:bg-muted/40' : 'cursor-default'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-sm text-foreground',
                            changed ? 'font-semibold' : 'font-medium'
                          )}
                        >
                          {t.title}
                        </span>
                        <TimeAgo
                          date={t.updatedAt}
                          className="shrink-0 text-[11px] text-muted-foreground/60"
                        />
                      </span>
                      <span className="mt-1 flex items-center gap-1.5">
                        {changed && (
                          <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                        )}
                        <StageChip
                          slot={t.stage.slot}
                          label={t.stage.label}
                          closed={t.stage.closed}
                          closedLabelId="portal.tickets.stage.closed"
                        />
                        <span className="font-mono text-[11px] text-muted-foreground/60">
                          {t.reference}
                        </span>
                        {changed && (
                          <span className="sr-only">
                            <FormattedMessage
                              id="widget.tickets.stageChanged"
                              defaultMessage="Status changed since your last visit"
                            />
                          </span>
                        )}
                      </span>
                    </span>
                    {/* Chevron only on rows that open something — the missing
                        chevron is what tells a legacy, thread-less row apart. */}
                    {openable && (
                      <ChevronRightIcon className="w-4 h-4 shrink-0 text-muted-foreground/40 rtl:rotate-180" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 pt-16 pb-16 text-center animate-in fade-in duration-200 motion-reduce:animate-none">
            <TicketIcon className="mb-2 w-8 h-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground/70">
              <FormattedMessage id="widget.tickets.empty" defaultMessage="No tickets yet" />
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground/50">
              <FormattedMessage
                id="widget.tickets.emptyHint"
                defaultMessage="Tickets your team opens will show up here."
              />
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
