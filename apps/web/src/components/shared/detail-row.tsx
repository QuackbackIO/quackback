import { cn } from '@/lib/shared/utils'
import { LocalDate } from '@/components/ui/local-date'

/** The format of a detail-panel date, e.g. "Jul 3, 2026". */
export const DETAIL_DATE: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}

/** A detail-panel date value, e.g. "Jul 3, 2026", in the viewer's locale once hydrated. */
export function DetailDate({ date }: { date: string }) {
  return <LocalDate date={date} options={DETAIL_DATE} />
}

/**
 * A metadata row for the detail panels (conversation + ticket), matching the
 * feedback post-detail "Manage" card: an optional leading outline icon + muted
 * label on the left, the control/value on the right. Rows with no icon sit flush
 * to the card padding, like the reference sidebar's Status row.
 */
export function DetailRow({
  icon: Icon,
  label,
  align = 'center',
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>
  label: string
  align?: 'center' | 'start'
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-3',
        align === 'start' ? 'items-start' : 'items-center'
      )}
    >
      {Icon ? (
        <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </div>
      ) : (
        <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      )}
      <div className="flex min-w-0 max-w-[62%] justify-end">{children}</div>
    </div>
  )
}
