/**
 * Color-coded chip for ticket priority.
 */
import { cn } from '@/lib/shared/utils'

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface TicketPriorityChipProps {
  priority: TicketPriority
  className?: string
}

const priorityStyles: Record<TicketPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  normal: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
}

export function TicketPriorityChip({ priority, className }: TicketPriorityChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        priorityStyles[priority],
        className
      )}
    >
      {priority}
    </span>
  )
}
