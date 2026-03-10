import { useCallback, useEffect, useRef } from 'react'

interface UseDismissTimerOptions {
  onConfirm: (id: string) => void
  delay?: number
}

export function useDismissTimer({ onConfirm, delay = 4000 }: UseDismissTimerOptions) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const startTimer = useCallback(
    (id: string) => {
      // Clear existing timer for this ID if any
      const existing = timers.current.get(id)
      if (existing) clearTimeout(existing)

      const timer = setTimeout(() => {
        timers.current.delete(id)
        onConfirm(id)
      }, delay)
      timers.current.set(id, timer)
    },
    [onConfirm, delay]
  )

  const cancelTimer = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const cancelAll = useCallback(() => {
    for (const timer of timers.current.values()) {
      clearTimeout(timer)
    }
    timers.current.clear()
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer)
      }
    }
  }, [])

  return { startTimer, cancelTimer, cancelAll }
}
