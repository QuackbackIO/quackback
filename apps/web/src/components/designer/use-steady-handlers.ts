import { useInsertionEffect, useRef, useState } from 'react'

type Handlers = Record<string, (...args: never[]) => unknown>

/**
 * The handlers, as functions that keep one identity for the builder's life
 * and each call the latest of its name. Hand them to a memoised part in
 * place of handlers made anew on each render, which close over a draft or a
 * pick that changes every time, so the part draws only when what it shows
 * changes. Call them from events and effects, never while rendering: the
 * latest are taken at commit, so a render React abandons changes nothing.
 */
export function useSteadyHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers)
  useInsertionEffect(() => {
    latest.current = handlers
  })
  const [steady] = useState(
    () =>
      Object.fromEntries(
        Object.keys(handlers).map((name) => [
          name,
          (...args: never[]) => latest.current[name]!(...args),
        ])
      ) as T
  )
  return steady
}
