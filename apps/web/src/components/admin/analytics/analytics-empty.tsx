import type { ElementType } from 'react'
import { cn } from '@/lib/shared/utils'

/** One consistent empty state for every analytics widget — same height, same
 *  centered treatment, so sections don't jump as you switch between them. */
export function AnalyticsEmpty({
  icon: Icon,
  message,
  className,
}: {
  icon?: ElementType
  message: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground',
        className
      )}
    >
      {Icon && <Icon className="h-6 w-6 opacity-40" aria-hidden />}
      <p>{message}</p>
    </div>
  )
}
