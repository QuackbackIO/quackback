import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'

interface TimeAgoProps {
  date: Date | string
  className?: string
}

// Compute time ago string - works on both server and client
function getTimeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  // Initialize with computed value for SSR
  const [timeAgo, setTimeAgo] = useState<string>(() => getTimeAgo(date))

  useEffect(() => {
    // Update immediately in case server/client time differs slightly
    setTimeAgo(getTimeAgo(date))

    // Update every minute
    const interval = setInterval(() => {
      setTimeAgo(getTimeAgo(date))
    }, 60000)

    return () => clearInterval(interval)
  }, [date])

  return <span className={className}>{timeAgo}</span>
}
