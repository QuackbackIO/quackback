import { useRef } from 'react'

/**
 * Whether two sets of props show the same: equal values, with arrays and
 * plain objects compared by what they hold, and functions and React
 * elements by identity. For memo() on a builder row whose props are worked
 * out afresh from the design on every change, such as its options, so it
 * draws again only when what it shows changes. Hand it handlers that keep
 * their identity (useSteadyHandlers).
 */
export function sameProps(before: object, after: object): boolean {
  return sameValue(before, after)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if ('$$typeof' in a || '$$typeof' in b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((each, at) => sameValue(each, b[at]))
  }
  if (
    Object.getPrototypeOf(a) !== Object.prototype ||
    Object.getPrototypeOf(b) !== Object.prototype
  )
    return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  if (keys.length !== Object.keys(y).length) return false
  return keys.every((key) => key in y && sameValue(x[key], y[key]))
}

/** The value itself while it holds the same as before, so what is handed on keeps its identity. */
export function useSame<T>(value: T): T {
  const kept = useRef(value)
  if (!sameValue(kept.current, value)) kept.current = value
  return kept.current
}
