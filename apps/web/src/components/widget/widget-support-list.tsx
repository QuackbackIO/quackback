import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { PlusIcon } from '@heroicons/react/24/solid'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  listWidgetTickets,
  type WidgetTicketRow,
  type StatusCategory,
  type WidgetSupportCategory,
} from '@/lib/client/widget/tickets-api'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetSupportListProps {
  onNewTicket: () => void
  onTicketSelect: (ticketId: string) => void
  categories?: WidgetSupportCategory[]
}

const RESOLVED_CATEGORIES: ReadonlySet<StatusCategory> = new Set(['solved', 'closed'])

export function WidgetSupportList({
  onNewTicket,
  onTicketSelect,
  categories = [],
}: WidgetSupportListProps) {
  const intl = useIntl()
  const { isIdentified, sessionVersion } = useWidgetAuth()
  const display = categories.length === 1 ? categories[0]?.display : undefined

  const { data, isLoading, error } = useQuery({
    queryKey: ['widget', 'tickets', 'list', sessionVersion],
    queryFn: () => listWidgetTickets({ limit: 50 }),
    enabled: isIdentified,
    refetchOnWindowFocus: true,
    staleTime: 15 * 1000,
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 pt-2 pb-2 shrink-0">
        <h2 className="text-sm font-semibold text-foreground">
          <FormattedMessage id="widget.support.list.heading" defaultMessage="Your tickets" />
        </h2>
        <button
          type="button"
          onClick={onNewTicket}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors"
        >
          <PlusIcon className="w-3 h-3" />
          <FormattedMessage id="widget.support.list.newTicket" defaultMessage="New ticket" />
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 pb-3">
          {!isIdentified && (
            <p className="text-xs text-muted-foreground/70 text-center py-8">
              <FormattedMessage
                id="widget.support.list.emptyAnonymous"
                defaultMessage="Sign in to view your tickets."
              />
            </p>
          )}

          {isIdentified && isLoading && (
            <div className="space-y-2 animate-pulse pt-1">
              <div className="h-12 bg-muted/30 rounded-md" />
              <div className="h-12 bg-muted/30 rounded-md" />
              <div className="h-12 bg-muted/30 rounded-md" />
            </div>
          )}

          {isIdentified && error && (
            <p className="text-xs text-destructive text-center py-8">
              <FormattedMessage
                id="widget.support.list.errorLoad"
                defaultMessage="Could not load your tickets."
              />
            </p>
          )}

          {isIdentified && data && data.rows.length === 0 && (
            <p className="text-xs text-muted-foreground/70 text-center py-8">
              {display?.emptyStateDescription ?? (
                <FormattedMessage
                  id="widget.support.list.empty"
                  defaultMessage="You haven't opened any tickets yet."
                />
              )}
            </p>
          )}

          {isIdentified && data && data.rows.length > 0 && (
            <ul className="divide-y divide-border/40 rounded-lg border border-border/60 overflow-hidden">
              {data.rows.map((row) => (
                <TicketRow
                  key={row.id}
                  row={row}
                  onSelect={() => onTicketSelect(row.id)}
                  resolvedLabel={intl.formatMessage({
                    id: 'widget.support.detail.resolved',
                    defaultMessage: 'Resolved',
                  })}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function TicketRow({
  row,
  onSelect,
  resolvedLabel,
}: {
  row: WidgetTicketRow
  onSelect: () => void
  resolvedLabel: string
}) {
  const isResolved = RESOLVED_CATEGORIES.has(row.statusCategory)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left bg-card hover:bg-muted/30 transition-colors px-3 py-2 flex flex-col gap-1"
      >
        <div className="flex items-center gap-1.5">
          <span
            className="size-1.5 rounded-full shrink-0"
            style={{ backgroundColor: row.statusColor ?? '#94a3b8' }}
          />
          <span className="text-[11px] text-muted-foreground truncate">
            {isResolved ? resolvedLabel : row.statusName}
          </span>
          <span className="text-[11px] text-muted-foreground/60 ms-auto shrink-0">
            <TimeAgo date={new Date(row.lastActivityAt)} />
          </span>
        </div>
        <p className="font-medium text-foreground text-sm line-clamp-1">{row.subject}</p>
      </button>
    </li>
  )
}
