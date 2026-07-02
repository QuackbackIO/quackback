import { useNavigate } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { cn } from '@/lib/shared/utils'

export type StatusFilterValue = 'open' | 'pending' | 'solved' | 'closed' | 'all'

const FILTERS: ReadonlyArray<{ value: StatusFilterValue; messageId: string; label: string }> = [
  { value: 'open', messageId: 'portal.tickets.filter.open', label: 'Open' },
  { value: 'pending', messageId: 'portal.tickets.filter.pending', label: 'Pending' },
  { value: 'solved', messageId: 'portal.tickets.filter.solved', label: 'Solved' },
  { value: 'closed', messageId: 'portal.tickets.filter.closed', label: 'Closed' },
  { value: 'all', messageId: 'portal.tickets.filter.all', label: 'All' },
]

export interface PortalTicketStatusFilterProps {
  value: StatusFilterValue
}

export function PortalTicketStatusFilter({ value }: PortalTicketStatusFilterProps) {
  const navigate = useNavigate({ from: '/tickets/' })
  return (
    <div role="group" aria-label="Filter tickets by status" className="flex flex-wrap gap-2">
      {FILTERS.map((f) => {
        const active = f.value === value
        return (
          <button
            key={f.value}
            type="button"
            aria-pressed={active}
            onClick={() => navigate({ search: { status: f.value } })}
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition',
              active
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground'
            )}
          >
            <FormattedMessage id={f.messageId} defaultMessage={f.label} />
          </button>
        )
      })}
    </div>
  )
}
