import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { COMPONENT_STATUS_STYLE, COMPONENT_STATUS_LABEL } from './status-colors'
import type { StatusComponentStatus } from '@/lib/server/domains/status'

export interface StatusUptimeDay {
  /** UTC day, `YYYY-MM-DD`. */
  date: string
  worstStatus: StatusComponentStatus
  /** 0-100, rounded to 2 decimal places. */
  uptimePct: number
}

interface StatusUptimeBarProps {
  days: StatusUptimeDay[]
  className?: string
}

function formatDayTitle(dateStr: string): string {
  // dateStr is a UTC calendar day (YYYY-MM-DD) — parse as UTC midnight so the
  // viewer's local timezone can't shift it to the adjacent day.
  const parsed = new Date(`${dateStr}T00:00:00Z`)
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * 90-day (or however many days the caller passes) uptime history for a single
 * component — a row of colored ticks, one per day, worst-status-colored, with
 * a native hover tooltip ("Jul 3 — Partial outage, 99.2%"). Hidden below the
 * `md` breakpoint (mirrors the approved mockup, which drops the bar and
 * summary row on narrow viewports in favor of just the current-status pill).
 */
export function StatusUptimeBar({ days, className }: StatusUptimeBarProps) {
  const intl = useIntl()

  if (days.length === 0) return null

  const avgUptimePct = days.reduce((sum, day) => sum + day.uptimePct, 0) / days.length

  return (
    <div className={cn('hidden min-w-0 max-w-[460px] flex-1 flex-col gap-1 md:flex', className)}>
      <div className="flex items-center gap-[2px] overflow-hidden">
        {days.map((day) => {
          const style = COMPONENT_STATUS_STYLE[day.worstStatus]
          const label = intl.formatMessage(COMPONENT_STATUS_LABEL[day.worstStatus])
          return (
            <span
              key={day.date}
              title={intl.formatMessage(
                {
                  id: 'portal.status.uptime.dayTooltip',
                  defaultMessage: '{day} — {label}, {pct}%',
                },
                { day: formatDayTitle(day.date), label, pct: day.uptimePct }
              )}
              className={cn('h-[26px] w-[3px] shrink-0 rounded-sm', style.dot)}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-[10.5px] text-muted-foreground/70">
        <span>
          {intl.formatMessage(
            { id: 'portal.status.uptime.daysAgo', defaultMessage: '{days} days ago' },
            { days: days.length }
          )}
        </span>
        <span>
          {intl.formatMessage(
            { id: 'portal.status.uptime.pct', defaultMessage: '{pct}% uptime' },
            { pct: avgUptimePct.toFixed(2) }
          )}
        </span>
        <span>
          {intl.formatMessage({ id: 'portal.status.uptime.today', defaultMessage: 'Today' })}
        </span>
      </div>
    </div>
  )
}
