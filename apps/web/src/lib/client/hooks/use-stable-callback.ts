import { useCallback, useInsertionEffect, useRef } from 'react'

/**
 * A function that keeps one identity for the component's lifetime and always
 * runs the latest `fn`. Pass it to a memoised child in place of a handler that
 * closes over values (a mutation result, a draft) which change every render,
 * so the child skips the renders it would otherwise take for nothing. Call it
 * from events and effects, never during render. The ref moves to the new `fn`
 * at commit, before any layout effect runs, so a render React abandons never
 * changes what the visible UI calls.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  const fnRef = useRef(fn)
  useInsertionEffect(() => {
    fnRef.current = fn
  })
  return useCallback((...args: Args) => fnRef.current(...args), [])
}
