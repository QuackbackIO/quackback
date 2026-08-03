/**
 * Color-coded status pill for tickets. Uses statusCategory to pick the colour
 * ramp; the displayed label comes from the status's `name` field.
 */
import { cn } from '@/lib/shared/utils'

export type StatusCategory = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'

export interface TicketStatusPillProps {
  name: string
  category: StatusCategory
  className?: string
}

const categoryStyles: Record<StatusCategory, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  on_hold: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  solved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  closed: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
}

export function TicketStatusPill({ name, category, className }: TicketStatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        categoryStyles[category],
        className
      )}
    >
      {name}
    </span>
  )
}
