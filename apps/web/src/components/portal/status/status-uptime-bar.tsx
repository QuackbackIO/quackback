import { useState, type KeyboardEvent } from 'react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { Tooltip, TooltipContent } from '@/components/ui/tooltip'
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
  /** The component the bar belongs to, for the bar's accessible name. */
  componentName: string
  className?: string
}

function formatDayTitle(dateStr: string, locale: string): string {
  // dateStr is a UTC calendar day (YYYY-MM-DD) — parse as UTC midnight so the
  // viewer's local timezone can't shift it to the adjacent day.
  const parsed = new Date(`${dateStr}T00:00:00Z`)
  return parsed.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * 90-day (or however many days the caller passes) uptime history for a single
 * component — a full-width row of colored bars that stretch to fill the
 * container, one per day, worst-status-colored, with a tooltip per day
 * ("Jul 3: Partial outage, 99.2%"). The classic status-page bar chart: bars
 * flex to share the width, never scroll or clip, and stay readable down to a
 * 2px floor on the narrowest viewports.
 *
 * Each day is a button named by its tooltip text, so it can be reached by
 * keyboard (the bar is one tab stop; arrow keys, Home and End move between
 * days) and opened by a tap. One controlled tooltip per bar, anchored to the
 * day in view, serves all the days: a page can carry 90 days per component.
 */
export function StatusUptimeBar({ days, componentName, className }: StatusUptimeBarProps) {
  const intl = useIntl()
  // The day that takes the bar's single tab stop (roving tabindex): the
  // latest day until the visitor moves.
  const [focusIndex, setFocusIndex] = useState(days.length - 1)
  // The day whose tooltip is showing, and the bar segment it points at.
  const [shown, setShown] = useState<{ index: number; anchor: HTMLElement } | null>(null)

  if (days.length === 0) return null
  // `days` can arrive after the first render (or change length), so the tab
  // stop falls back to the latest day whenever the remembered one is gone.
  const tabStop = focusIndex >= 0 && focusIndex < days.length ? focusIndex : days.length - 1

  const avgUptimePct = days.reduce((sum, day) => sum + day.uptimePct, 0) / days.length

  const dayLabel = (day: StatusUptimeDay) =>
    intl.formatMessage(
      { id: 'portal.status.uptime.dayTooltip', defaultMessage: '{day}: {label}, {pct}%' },
      {
        day: formatDayTitle(day.date, intl.locale),
        label: intl.formatMessage(COMPONENT_STATUS_LABEL[day.worstStatus]),
        pct: intl.formatNumber(day.uptimePct, { maximumFractionDigits: 2 }),
      }
    )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = days.length - 1
    // Arrow keys follow the reading direction, so they flip in RTL.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[event.key]
    let next: number | null = null
    if (step !== undefined) next = Math.min(last, Math.max(0, tabStop + step))
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    setFocusIndex(next)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div
        role="group"
        aria-label={intl.formatMessage(
          {
            id: 'portal.status.uptime.barLabel',
            defaultMessage: '{component} uptime, last {days} days',
          },
          { component: componentName, days: days.length }
        )}
        className="flex h-7 items-stretch gap-px sm:gap-0.5"
        onKeyDown={handleKeyDown}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setShown(null)
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setShown(null)
        }}
      >
        {days.map((day, index) => (
          <button
            key={day.date}
            type="button"
            tabIndex={index === tabStop ? 0 : -1}
            aria-label={dayLabel(day)}
            className={cn(
              'h-full min-w-[2px] flex-1 rounded-xs transition-opacity outline-none hover:opacity-60',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              COMPONENT_STATUS_STYLE[day.worstStatus].dot
            )}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') setShown({ index, anchor: event.currentTarget })
            }}
            onFocus={(event) => {
              setFocusIndex(index)
              setShown({ index, anchor: event.currentTarget })
            }}
            // A tap: touch screens have no hover, and Safari doesn't focus a
            // tapped button, so the press itself opens the day.
            onClick={(event) => setShown({ index, anchor: event.currentTarget })}
          />
        ))}
      </div>
      <Tooltip
        open={shown !== null}
        onOpenChange={(open) => {
          if (!open) setShown(null)
        }}
      >
        <TooltipContent anchor={shown?.anchor}>
          {shown && days[shown.index] ? dayLabel(days[shown.index]) : null}
        </TooltipContent>
      </Tooltip>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {intl.formatMessage(
            { id: 'portal.status.uptime.daysAgo', defaultMessage: '{days} days ago' },
            { days: days.length }
          )}
        </span>
        <span className="font-medium text-muted-foreground">
          {intl.formatMessage(
            { id: 'portal.status.uptime.pct', defaultMessage: '{pct}% uptime' },
            {
              pct: intl.formatNumber(avgUptimePct, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
            }
          )}
        </span>
        <span>
          {intl.formatMessage({ id: 'portal.status.uptime.today', defaultMessage: 'Today' })}
        </span>
      </div>
    </div>
  )
}
