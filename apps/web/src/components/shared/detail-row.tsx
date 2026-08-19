import { cn } from '@/lib/shared/utils'

/** Format an ISO date as e.g. "Jul 3, 2026" for a detail-panel value. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
