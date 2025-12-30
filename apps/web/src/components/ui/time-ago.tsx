'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'

interface TimeAgoProps {
  date: Date | string
  className?: string
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  const [timeAgo, setTimeAgo] = useState<string>('')

  useEffect(() => {
    const d = new Date(date)

    const updateTime = () => {
      setTimeAgo(formatDistanceToNow(d, { addSuffix: true }))
    }

    // Set initial value
    updateTime()

    // Update every minute
    const interval = setInterval(updateTime, 60000)

    return () => clearInterval(interval)
  }, [date])

  // Return empty span with same structure to avoid layout shift
  if (!timeAgo) {
    return <span className={className} />
  }

  return <span className={className}>{timeAgo}</span>
}
