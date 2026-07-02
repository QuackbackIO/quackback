import { format, formatDistanceToNow } from 'date-fns'
import { useIntl } from 'react-intl'
import { TicketStatusPill } from '@/components/admin/tickets/ticket-status-pill'
import type { PortalStatusCategory } from '@/lib/client/queries/portal-tickets'

export interface PortalTicketDetailHeaderProps {
  subject: string
  statusName: string
  statusCategory: PortalStatusCategory
  createdAt: Date
  lastActivityAt: Date
}

export function PortalTicketDetailHeader({
  subject,
  statusName,
  statusCategory,
  createdAt,
  lastActivityAt,
}: PortalTicketDetailHeaderProps) {
  const intl = useIntl()
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{subject}</h1>
        <TicketStatusPill name={statusName} category={statusCategory} />
      </div>
      <p className="text-xs text-muted-foreground">
        {intl.formatMessage(
          { id: 'portal.tickets.detail.openedAt', defaultMessage: 'Opened {date}' },
          { date: format(createdAt, 'PP') }
        )}
        {' · '}
        {intl.formatMessage(
          { id: 'portal.tickets.detail.lastUpdate', defaultMessage: 'Last update {when}' },
          { when: formatDistanceToNow(lastActivityAt, { addSuffix: true }) }
        )}
      </p>
    </header>
  )
}
