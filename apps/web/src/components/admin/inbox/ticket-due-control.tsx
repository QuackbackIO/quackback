/**
 * The ticket's shared due date in the detail panel: the picker teammates set
 * it with, and the countdown chip beside it. One value for both sides: the
 * customer may have proposed it when filing, and a customer-type ticket shows
 * it back to them. Independent of the SLA's time-to-resolve target, which has
 * its own chip.
 */
import { useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ClockIcon, EyeIcon } from '@heroicons/react/24/outline'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import { useSetTicketDueAt } from '@/lib/client/mutations/inbox'
import { useNow } from '@/lib/client/hooks/use-now'
import { formatSlaCountdown, type SlaChipTone } from '@/lib/shared/conversation/sla'
import { ticketDueBounds, ticketDueState, type TicketDueState } from '@/lib/shared/ticket-due'
import { TONE_CLASSES } from '@/components/admin/conversation/sla-chip'
import { TICKET_DUE_DATE_TIME } from '@/components/admin/inbox/ticket-due-marker'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { useLocalDateFormatter } from '@/components/ui/local-date'
import { cn } from '@/lib/shared/utils'

/** The chip's tone per due state, on the SLA chip's tone ladder. */
const DUE_TONE: Record<TicketDueState, SlaChipTone> = {
  overdue: 'overdue',
  due_soon: 'due_soon',
  scheduled: 'ok',
}

/**
 * The countdown to the ticket's shared due date (`tickets.due_at`), styled
 * like the SLA chip but not an SLA target. The tone comes from
 * `ticketDueState`, so it agrees with the inbox row marker and the due
 * filter. Renders nothing with no due date or once the ticket is closed, and
 * only after mount (the label depends on "now").
 */
export function TicketDueChip({ dueAt, closed }: { dueAt: string | null; closed: boolean }) {
  const intl = useIntl()
  const formatDate = useLocalDateFormatter()
  const now = useNow(30_000)
  if (!now) return null
  const state = ticketDueState(dueAt, closed, now)
  if (!state || !dueAt) return null

  const remainingMs = Date.parse(dueAt) - now.getTime()
  const duration = formatSlaCountdown(Math.abs(remainingMs))

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        TONE_CLASSES[DUE_TONE[state]]
      )}
      title={intl.formatMessage(
        { id: 'admin.ticketDue.chipTitle', defaultMessage: 'Due {date}' },
        { date: formatDate(dueAt, TICKET_DUE_DATE_TIME) }
      )}
    >
      <ClockIcon className="h-3 w-3" aria-hidden />
      {state === 'overdue'
        ? intl.formatMessage(
            { id: 'admin.inbox.row.due.overdue', defaultMessage: '{duration} over' },
            { duration }
          )
        : duration}
    </span>
  )
}

const sameInstant = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null)

/**
 * Set, move or clear the ticket's due date. The picker holds a draft while it
 * is open and saves once when it closes, so trying a few days and times costs
 * one write; clearing saves at once. The new value shows while the save is in
 * flight and falls back to the stored one if it fails.
 */
export function TicketDueControl({
  ticket,
  onChanged,
}: {
  ticket: TicketDTO
  onChanged?: () => void
}) {
  const intl = useIntl()
  const mutation = useSetTicketDueAt()
  const stored = ticket.dueAt ? new Date(ticket.dueAt) : null
  // The draft lives only while the popover is open (undefined otherwise);
  // the ref lets the close handler read the latest pick.
  const [draft, setDraftState] = useState<Date | null | undefined>(undefined)
  const draftRef = useRef<Date | null | undefined>(undefined)
  const setDraft = (next: Date | null | undefined) => {
    draftRef.current = next
    setDraftState(next)
  }
  // Fixed when the popover opens, so the bounds don't shift under the calendar.
  const [bounds, setBounds] = useState(() => ticketDueBounds('team'))

  const save = (dueAt: Date | null) => {
    if (sameInstant(dueAt, stored)) return
    mutation.mutate(
      { ticketId: ticket.id, dueAt },
      {
        onSuccess: () => onChanged?.(),
        onError: () =>
          toast.error(
            intl.formatMessage({
              id: 'admin.ticketDue.saveFailed',
              defaultMessage: 'Failed to update the due date',
            })
          ),
      }
    )
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setBounds(ticketDueBounds('team'))
      setDraft(stored)
      return
    }
    const picked = draftRef.current
    setDraft(undefined)
    if (picked !== undefined) save(picked)
  }

  const pending = mutation.isPending ? mutation.variables.dueAt : undefined
  const shown = draft !== undefined ? draft : pending !== undefined ? pending : stored
  const customerSees = ticket.type === 'customer'
  const customerHint = intl.formatMessage({
    id: 'admin.ticketDue.customerVisible',
    defaultMessage: 'The customer sees this date.',
  })

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {customerSees && (
        <span title={customerHint} className="inline-flex shrink-0 text-muted-foreground/70">
          <EyeIcon className="size-3.5" aria-hidden />
          <span className="sr-only">{customerHint}</span>
        </span>
      )}
      <DateTimePicker
        value={shown ?? undefined}
        onChange={(next) => setDraft(next ?? null)}
        onOpenChange={handleOpenChange}
        onClear={() => {
          setDraft(undefined)
          save(null)
        }}
        clearLabel={intl.formatMessage({
          id: 'admin.ticketDue.clear',
          defaultMessage: 'Clear due date',
        })}
        minDate={bounds.min}
        maxDate={bounds.max}
        placeholder={intl.formatMessage({
          id: 'admin.ticketDue.placeholder',
          defaultMessage: 'Set due date',
        })}
        className="h-7 min-w-0 text-xs"
      />
    </span>
  )
}
