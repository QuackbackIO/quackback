import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { LIFECYCLE_STYLE, LIFECYCLE_LABEL } from './status-colors'
import type { LifecycleStatus } from './status-colors'

export interface StatusIncidentTimelineUpdate {
  id: string
  status: LifecycleStatus
  body: string
  createdAt: string
}

interface StatusIncidentTimelineProps {
  updates: StatusIncidentTimelineUpdate[]
  /** Compact rows show only the time (`14:22 UTC`) — used inside the
   *  day-grouped past-incidents list, where the day header already carries
   *  the date. The full incident detail page shows the full date + time. */
  compact?: boolean
  className?: string
}

function formatTimestamp(iso: string, compact: boolean): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
  if (compact) return `${time} UTC`
  const day = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return `${day} · ${time} UTC`
}

/** Vertical update timeline (from post-activity-timeline's colored
 *  status-pill pattern): latest update first, a colored dot per lifecycle
 *  status, the update body, and its timestamp. */
export function StatusIncidentTimeline({
  updates,
  compact = false,
  className,
}: StatusIncidentTimelineProps) {
  const intl = useIntl()
  // `updates` arrives oldest-first from the server; the timeline reads
  // newest-first (mirrors the approved mockup and Statuspage convention).
  const sorted = useMemo(() => [...updates].reverse(), [updates])

  if (compact) {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        {sorted.map((update) => {
          const style = LIFECYCLE_STYLE[update.status]
          return (
            <div key={update.id} className="flex items-baseline gap-2 text-[13px]">
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold',
                  style.soft,
                  style.text
                )}
              >
                {intl.formatMessage(LIFECYCLE_LABEL[update.status])}
              </span>
              <span className="min-w-0 flex-1 text-muted-foreground">{update.body}</span>
              <span className="shrink-0 whitespace-nowrap text-[11.5px] text-muted-foreground/70">
                {formatTimestamp(update.createdAt, true)}
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={cn('border-t border-border/40', className)}>
      {sorted.map((update) => {
        const style = LIFECYCLE_STYLE[update.status]
        return (
          <div key={update.id} className="flex gap-3.5 border-b border-border/40 py-5">
            <div className="flex flex-col items-center pt-0.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <span className={cn('h-2 w-2 rounded-full', style.dot)} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className={cn('text-[13px] font-bold', style.text)}>
                  {intl.formatMessage(LIFECYCLE_LABEL[update.status])}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(update.createdAt, false)}
                </span>
              </div>
              <p className="mt-1.5 max-w-[72ch] text-[14.5px] text-foreground/90">{update.body}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
