import { ArrowUpRightIcon, ArrowDownRightIcon } from '@heroicons/react/20/solid'
import { cn } from '@/lib/shared/utils'

interface TrendDeltaProps {
  /** Period-over-period change as a whole-number percent (e.g. 12 = +12%). */
  value: number
  /** Trailing context label, e.g. "vs prev". Omit for a bare badge. */
  suffix?: string
  className?: string
}

/** Period-over-period delta. At 0 there's no signal worth the ink, but the badge
 *  still holds its line (`h-4`) so equal-height layouts don't jump — callers get
 *  consistent spacing without each reserving the slot themselves. Up reads
 *  success, down reads destructive — from theme tokens, so it tracks light/dark
 *  instead of hardcoded greens/reds. */
export function TrendDelta({ value, suffix, className }: TrendDeltaProps) {
  if (value === 0) return <span className={cn('block h-4', className)} aria-hidden />
  const up = value > 0
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span
      className={cn(
        'inline-flex h-4 items-center gap-0.5 text-xs font-medium tabular-nums',
        up ? 'text-success' : 'text-destructive',
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {up ? '+' : ''}
      {value}%{suffix && <span className="ml-1 font-normal text-muted-foreground">{suffix}</span>}
    </span>
  )
}
