import { useEffect, useState } from 'react'

/**
 * Generic debounced-value hook. Returns the latest `value` only after
 * it has stayed unchanged for `delayMs`. Cancels pending updates on
 * unmount or when `value` changes again before the timer fires.
 *
 * Use this for derived debounced filters / queries that just need a
 * settled value. For inputs that sync bidirectionally with an
 * external state (URL params, parent-controlled value) use
 * `useDebouncedSearch` instead — it handles the round-trip + the
 * stale-callback ref pattern.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
