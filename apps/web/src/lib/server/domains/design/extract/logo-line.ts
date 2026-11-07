/**
 * A widely spaced wordmark the finder's box stops short of (a centred
 * header's capitals, "PATRE" of a longer name): the groups of ink on the
 * mark's line, as tall as it, and as far from it as its own letters are from
 * each other, belong to it. Menu words sit further off, or at another height.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { Box } from './kinds'

interface Group {
  members: number[]
}

/** The chosen groups with the groups on their line added, nearest first. */
export function alongLine<G extends Group>(
  chosen: G[],
  rest: G[],
  boxOf: (member: number) => Box
): G[] {
  const out = [...chosen]
  const bounds = (members: number[]): Box =>
    members.reduce<Box>(
      (t, i) => {
        const c = boxOf(i)
        return [
          Math.min(t[0], c[0]),
          Math.min(t[1], c[1]),
          Math.max(t[2], c[2]),
          Math.max(t[3], c[3]),
        ]
      },
      [Infinity, Infinity, -Infinity, -Infinity]
    )
  // The widest gap between the mark's own letters.
  const spans = out
    .flatMap((e) => e.members)
    .map(boxOf)
    .sort((p, q) => p[0] - q[0])
    .reduce<Array<[number, number]>>((acc, c) => {
      const last = acc[acc.length - 1]
      if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[2])
      else acc.push([c[0], c[2]])
      return acc
    }, [])
  const spacing = Math.max(0, ...spans.slice(1).map((sp, i) => sp[0] - spans[i]![1]))
  for (let grew = spacing > 0; grew;) {
    grew = false
    const t = bounds(out.flatMap((e) => e.members))
    const th = t[3] - t[1]
    for (const e of rest) {
      if (out.includes(e)) continue
      const q = bounds(e.members)
      const overlap = Math.min(t[3], q[3]) - Math.max(t[1], q[1])
      const gap = Math.max(q[0] - t[2], t[0] - q[2])
      if (
        overlap >= 0.8 * Math.max(th, q[3] - q[1]) &&
        gap > 0 &&
        gap <= Math.min(0.8 * th, 1.5 * spacing + 1)
      ) {
        out.push(e)
        grew = true
      }
    }
  }
  return out
}
