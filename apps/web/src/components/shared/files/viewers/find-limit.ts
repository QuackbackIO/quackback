/** Matches an engine's find counts before it stops; the bar then reads "1 of 10,000+". */
export const MAX_FIND_MATCHES = 10_000

/** The next (or previous, `direction` -1) match index, wrapping; -1 when none. */
export function stepMatch(index: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1
  if (index < 0) return direction === 1 ? 0 : count - 1
  return (index + direction + count) % count
}
