/**
 * Shared customer-facing stage UI (support platform §4.2): the soft stage chip
 * on ticket-list rows and the received -> in_progress -> awaiting_requester ->
 * resolved tracker atop a ticket thread. One implementation serves both the
 * portal and the Messenger widget — the only difference between the two
 * surfaces was the locale id of the B22 generic-close label, which callers
 * pass in (`closedLabelId`) so each keeps its own extracted message.
 *
 * B19: `labels` are the workspace's CUSTOMIZED stage labels (chips/emails
 * always used them; the tracker once hardcoded the defaults).
 * B22 generic-close projection: a status with no public stage ("Won't do",
 * "Duplicate") renders a muted "Closed" affordance instead of nothing — the
 * internal status name never leaks.
 */
import { FormattedMessage } from 'react-intl'
import { TICKET_STAGES } from '@/lib/shared/db-types'
import { DEFAULT_TICKET_STAGE_LABELS } from '@/lib/shared/tickets'
import { cn } from '@/lib/shared/utils'

/** Semantic soft-chip colors per customer-facing stage — neutral while queued,
 *  blue while worked, amber when the ball is in the requester's court
 *  (Intercom's "waiting on customer" attention state), emerald when done. */
const STAGE_CHIP_CLASS: Record<string, string> = {
  received: 'bg-muted/60 text-muted-foreground',
  in_progress: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  awaiting_requester: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  resolved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}

export function StageChip({
  slot,
  label,
  closed = false,
  closedLabelId,
}: {
  slot: string | null
  label: string | null
  closed?: boolean
  /** Locale id of the B22 muted "Closed" label (per-surface extracted message). */
  closedLabelId: string
}) {
  if (!label) {
    // B22: a null-stage closed status used to render no chip at all — a
    // silent dead end. Show the muted localized "Closed" instead.
    if (!closed) return null
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <FormattedMessage id={closedLabelId} defaultMessage="Closed" />
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        (slot && STAGE_CHIP_CLASS[slot]) ?? 'bg-muted/60 text-muted-foreground'
      )}
    >
      {label}
    </span>
  )
}

/** The received -> in_progress -> awaiting_requester -> resolved progress bar,
 *  with every stage labeled under its segment (Featurebase/Intercom show the
 *  full progression, not just the current stop). Mobile keeps only the current
 *  label — four labels don't fit a phone row. B22: a closed ticket with no
 *  stage slot shows a single quiet "Closed" bar instead of no tracker. */
export function StageTracker({
  slot,
  closed = false,
  labels,
  closedLabelId,
}: {
  slot: string | null
  closed?: boolean
  labels: Record<string, string>
  /** Locale id of the B22 "Closed" bar label (per-surface extracted message). */
  closedLabelId: string
}) {
  if (!slot && !closed) return null
  if (!slot) {
    return (
      <div aria-label="Ticket progress">
        <span className="block h-1.5 rounded-full bg-muted-foreground/30" />
        <span className="mt-1.5 block text-[11px] font-semibold text-muted-foreground">
          <FormattedMessage id={closedLabelId} defaultMessage="Closed" />
        </span>
      </div>
    )
  }
  const currentIndex = TICKET_STAGES.indexOf(slot as (typeof TICKET_STAGES)[number])
  return (
    <ol className="flex items-start gap-1.5" aria-label="Ticket progress">
      {TICKET_STAGES.map((stage, i) => {
        const reached = i <= currentIndex
        const current = i === currentIndex
        return (
          <li key={stage} aria-current={current ? 'step' : undefined} className="flex-1">
            <span
              className={cn(
                'block h-1.5 rounded-full transition-colors',
                reached ? (slot === 'resolved' ? 'bg-emerald-500' : 'bg-primary') : 'bg-border'
              )}
            />
            <span
              className={cn(
                'mt-1.5 block text-[11px]',
                current
                  ? 'font-semibold text-foreground'
                  : 'hidden text-muted-foreground/70 sm:block'
              )}
            >
              {labels[stage] ?? DEFAULT_TICKET_STAGE_LABELS[stage]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
