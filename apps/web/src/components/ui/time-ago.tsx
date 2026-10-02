import { useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'

interface TimeAgoProps {
  date: Date | string
  className?: string
  /** The compact age a dense list shows ("5m") in place of "5 minutes ago". */
  short?: boolean
}

/** The relative-time label `<TimeAgo>` renders, for static (no-interval)
 *  consumers like CitationFreshness; '' for a missing or invalid date. */
export function getTimeAgo(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  // Check for invalid date
  if (isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true })
}

/** The compact age `<TimeAgo short>` renders: "now", "5m", "3h", "2d"; '' for
 *  a missing or invalid date. */
export function getShortTimeAgo(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function TimeAgo({ date, className, short = false }: TimeAgoProps) {
  const getLabel = short ? getShortTimeAgo : getTimeAgo
  // Initialize with computed value for SSR
  const [timeAgo, setTimeAgo] = useState<string>(() => getLabel(date))
  // The server's label and the hydrating browser's can straddle a boundary
  // ("59 minutes ago", "about 1 hour ago"). Hydration keeps the server's text
  // without complaint, and a changed key replaces it once mounted.
  const [remount, setRemount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    // Update immediately in case server/client time differs slightly
    const label = getLabel(date)
    setTimeAgo(label)
    if (ref.current && ref.current.textContent !== label) setRemount((n) => n + 1)

    // Update every minute
    const interval = setInterval(() => {
      setTimeAgo(getLabel(date))
    }, 60000)

    return () => clearInterval(interval)
  }, [date, getLabel])

  return (
    <span key={remount} ref={ref} className={className} suppressHydrationWarning>
      {timeAgo}
    </span>
  )
}
