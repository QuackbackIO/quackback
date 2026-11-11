/**
 * `next`, with every part equal in content to `prev`'s kept as the very
 * object `prev` holds, and `prev` itself when nothing changed. A change to a
 * design copies the whole document first, so without this every part of it
 * would be new after any change, and whatever reads one part (the menu, the
 * brand) would have to draw again for a change to another. Plain JSON data
 * only: objects, arrays and primitives, as a design is.
 */
export function shareUnchanged<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null)
    return next
  if (Array.isArray(prev) !== Array.isArray(next)) return next
  if (Array.isArray(next)) {
    const before = prev as unknown[]
    let same = before.length === next.length
    const shared = next.map((value, at) => {
      const kept = shareUnchanged(before[at], value)
      if (kept !== before[at]) same = false
      return kept
    })
    return (same ? prev : shared) as T
  }
  const before = prev as Record<string, unknown>
  const after = next as Record<string, unknown>
  const keys = Object.keys(after)
  let same = keys.length === Object.keys(before).length
  const shared: Record<string, unknown> = {}
  for (const key of keys) {
    const kept = Object.hasOwn(before, key) ? shareUnchanged(before[key], after[key]) : after[key]
    shared[key] = kept
    if (!Object.hasOwn(before, key) || kept !== before[key]) same = false
  }
  return (same ? prev : shared) as T
}
