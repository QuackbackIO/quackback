/**
 * Presentational chips + badges for tickets (support platform §4.2): the type
 * badge, the status chip (tinted by category, with the status's own colour dot),
 * and the requester-facing stage chip. Pure display — no data fetching — so both
 * the list rows and the detail panel render tickets identically.
 */
import type { TicketStatusRef, TicketStageRef } from '@/lib/server/domains/tickets'
import type { TicketType, TicketStatusCategory } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

const TYPE_META: Record<TicketType, { label: string; className: string }> = {
  customer: { label: 'Customer', className: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
  back_office: {
    label: 'Back office',
    className: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  },
  tracker: { label: 'Tracker', className: 'bg-muted text-muted-foreground' },
}

export function ticketTypeLabel(type: TicketType): string {
  return TYPE_META[type].label
}

/** The type badge's tint, keyed by ticket type — shared with the inbox list
 *  row's type-glyph avatar (conversation-list-column.tsx) so the two surfaces
 *  can't drift apart. */
export const TICKET_TYPE_CLASS: Record<TicketType, string> = {
  customer: TYPE_META.customer.className,
  back_office: TYPE_META.back_office.className,
  tracker: TYPE_META.tracker.className,
}

/** A small pill naming a ticket's type (Customer / Back office / Tracker). */
export function TicketTypeBadge({ type, className }: { type: TicketType; className?: string }) {
  const meta = TYPE_META[type]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        meta.className,
        className
      )}
    >
      {meta.label}
    </span>
  )
}

// The chip is tinted by category but never renders the category label (it shows
// the status's own name), so this is a class map only — the label lives in the
// shared TICKET_STATUS_CATEGORY_LABELS the settings list + list filter use.
// Exported so the list row's linked-ticket summary chip (conversation-list-
// column.tsx, which carries no full TicketStatusRef to reuse TicketStatusChip
// itself) can tint by the same category without its own copy.
export const CATEGORY_CHIP: Record<TicketStatusCategory, string> = {
  open: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  pending: 'bg-amber-400/15 text-amber-700 dark:text-amber-300',
  closed: 'bg-muted text-muted-foreground',
}

/**
 * A status pill tinted by the status's category (open / pending / closed), with a
 * dot in the status's own configured colour so custom statuses stay
 * distinguishable within a category.
 */
export function TicketStatusChip({
  status,
  className,
}: {
  status: TicketStatusRef
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        CATEGORY_CHIP[status.category],
        className
      )}
    >
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: status.color }}
      />
      <span className="truncate">{status.name}</span>
    </span>
  )
}

/**
 * The requester-facing stage a status projects to. Renders nothing for an
 * internal-only status (no projected stage).
 */
export function TicketStageChip({
  stage,
  className,
}: {
  stage: TicketStageRef
  className?: string
}) {
  if (!stage.slot || !stage.label) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-border/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground',
        className
      )}
    >
      {stage.label}
    </span>
  )
}
