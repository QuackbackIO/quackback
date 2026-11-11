import { useRef } from 'react'

/**
 * Whether two sets of props show the same: equal values, with arrays and
 * plain objects compared by what they hold. For memo() on a builder row whose
 * props are worked out afresh from the design on every change, such as its
 * options, so it draws again only when what it shows changes. Hand it
 * handlers that keep their identity (useSteadyHandlers).
 */
export function sameProps(before: object, after: object): boolean {
  const a = before as Record<string, unknown>
  const b = after as Record<string, unknown>
  const keys = Object.keys(b)
  if (keys.length !== Object.keys(a).length) return false
  return keys.every((key) => sameValue(a[key], b[key]))
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The value itself while it holds the same as before, so what is handed on keeps its identity. */
export function useSame<T>(value: T): T {
  const kept = useRef(value)
  if (!sameValue(kept.current, value)) kept.current = value
  return kept.current
}
