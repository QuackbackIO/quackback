import { useIntl } from 'react-intl'
// The inbox detail panel's own clock (24/outline): one icon module for the
// whole inbox, so the row marker adds no chunk to the list.
import { ClockIcon } from '@heroicons/react/24/outline'
import { formatSlaCountdown } from '@/lib/shared/conversation/sla'
import { ticketDueState } from '@/lib/shared/ticket-due'
import { useNow } from '@/lib/client/hooks/use-now'
import { cn } from '@/lib/shared/utils'

/** A due date with its time, e.g. "Oct 21, 2026, 5:00 PM". */
export const TICKET_DUE_DATE_TIME: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

/**
 * The inbox row's due marker: a quiet clock and a compact countdown for an
 * open ticket that is overdue ("2h over", red) or due within the next 24
 * hours ("5h 10m", amber). Renders nothing for a ticket with no due date, a
 * closed ticket, or one due further out, so a row only carries it when it
 * asks for attention. Rendered after mount only, since it reads the clock.
 */
export function TicketDueMarker({ dueAt, closed }: { dueAt: string | null; closed: boolean }) {
  // No timer for the rows that can never show a marker.
  if (!dueAt || closed) return null
  return <DueCountdown dueAt={dueAt} />
}

function DueCountdown({ dueAt }: { dueAt: string }) {
  const now = useNow()
  if (!now) return null
  const state = ticketDueState(dueAt, false, now)
  if (state !== 'overdue' && state !== 'due_soon') return null
  return <DueCountdownLabel overdue={state === 'overdue'} remainingMs={Date.parse(dueAt) - +now} />
}

function DueCountdownLabel({ overdue, remainingMs }: { overdue: boolean; remainingMs: number }) {
  const intl = useIntl()
  const duration = formatSlaCountdown(Math.abs(remainingMs))
  const description = overdue
    ? intl.formatMessage(
        { id: 'admin.inbox.row.due.overdueLabel', defaultMessage: 'Overdue by {duration}' },
        { duration }
      )
    : intl.formatMessage(
        { id: 'admin.inbox.row.due.dueSoonLabel', defaultMessage: 'Due in {duration}' },
        { duration }
      )
  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 text-xs font-medium tabular-nums',
        overdue ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'
      )}
    >
      <ClockIcon className="size-3" aria-hidden />
      <span aria-hidden>
        {overdue
          ? intl.formatMessage(
              { id: 'admin.inbox.row.due.overdue', defaultMessage: '{duration} over' },
              { duration }
            )
          : duration}
      </span>
    </span>
  )
}
