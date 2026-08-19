import { useCallback, useEffect, useRef } from 'react'

/**
 * Debounce a save action over the latest queued value, with flush-on-demand
 * and flush-on-unmount so navigating away never drops a pending edit.
 *
 * Unlike `useDebouncedValue` (which debounces a value for derived reads),
 * this debounces a side effect: `queue(v)` records the newest value and
 * (re)arms the timer; `flush()` fires immediately with whatever is queued.
 * `hasPending()` lets callers guard against clobbering newer local state
 * with a stale in-flight response.
 *
 * Used by the status settings page (text fields save debounced, switches
 * immediately) and the incident editor's autosaving sidebar.
 */
export function useDebouncedSave<T>(save: (value: T) => void, delayMs: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queued = useRef<T | null>(null)
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const value = queued.current
    queued.current = null
    if (value !== null) saveRef.current(value)
  }, [])

  const queue = useCallback(
    (value: T) => {
      queued.current = value
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delayMs)
    },
    [delayMs, flush]
  )

  const hasPending = useCallback(() => queued.current !== null, [])

  // Flush on unmount so closing the surface never drops typed text.
  useEffect(() => flush, [flush])

  return { queue, flush, hasPending }
}
