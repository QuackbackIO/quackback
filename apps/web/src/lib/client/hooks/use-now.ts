import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every `intervalMs`. Null on the server and in
 * the render that hydrates, so anything worked out from "now" (a countdown,
 * an overdue marker) renders only in the browser and never disagrees with the
 * server's markup.
 */
export function useNow(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
