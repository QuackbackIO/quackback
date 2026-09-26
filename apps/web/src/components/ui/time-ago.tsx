import { useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'

interface TimeAgoProps {
  date: Date | string
  className?: string
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

export function TimeAgo({ date, className }: TimeAgoProps) {
  // Initialize with computed value for SSR
  const [timeAgo, setTimeAgo] = useState<string>(() => getTimeAgo(date))
  // The server's label and the hydrating browser's can straddle a boundary
  // ("59 minutes ago", "about 1 hour ago"). Hydration keeps the server's text
  // without complaint, and a changed key replaces it once mounted.
  const [remount, setRemount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    // Update immediately in case server/client time differs slightly
    const label = getTimeAgo(date)
    setTimeAgo(label)
    if (ref.current && ref.current.textContent !== label) setRemount((n) => n + 1)

    // Update every minute
    const interval = setInterval(() => {
      setTimeAgo(getTimeAgo(date))
    }, 60000)

    return () => clearInterval(interval)
  }, [date])

  return (
    <span key={remount} ref={ref} className={className} suppressHydrationWarning>
      {timeAgo}
    </span>
  )
}
