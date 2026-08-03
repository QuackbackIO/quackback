import { Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { useIntl } from 'react-intl'
import { TicketStatusPill } from '@/components/admin/tickets/ticket-status-pill'
import type { PortalTicketRow } from '@/lib/client/queries/portal-tickets'

export interface PortalTicketRowProps {
  ticket: PortalTicketRow
}

export function PortalTicketRowItem({ ticket }: PortalTicketRowProps) {
  const intl = useIntl()
  const updated = formatDistanceToNow(ticket.lastActivityAt, { addSuffix: true })
  return (
    <Link
      to="/tickets/$ticketId"
      params={{ ticketId: ticket.id }}
      className="block rounded-md border border-border/50 bg-background px-4 py-3 transition hover:border-border hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">{ticket.subject}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {intl.formatMessage(
              { id: 'portal.tickets.row.updated', defaultMessage: 'Updated {when}' },
              { when: updated }
            )}
          </p>
        </div>
        <TicketStatusPill
          name={ticket.statusName}
          category={ticket.statusCategory}
          className="shrink-0"
        />
      </div>
    </Link>
  )
}
