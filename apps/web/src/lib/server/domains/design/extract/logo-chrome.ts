/**
 * What the cut leaves out though it sits close to the mark: site chrome
 * beside a logo, and a grainy header's grain on the far side of its colour.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { RGB } from './color'
import type { Box } from './kinds'

/** A connected piece of ink in the cut's region (region coordinates). */
export interface Comp {
  box: Box
  area: number
  inside: number
  /** Summed colour, for the component's mean. */
  sum: RGB
  /** Not the mark: site chrome beside it. */
  drop?: boolean
}

/** A frame drawn this little of its box is an outline (a pill, a button's border), not a filled shape. */
const FRAME_FILL = 0.35
/** A frame with this share of its width past the finder's box is beside the logo, not part of it. */
const FRAME_OUTSIDE = 0.5

/**
 * Marks site chrome beside the logo as not the mark (Comp.drop): an outline
 * framing other ink (a star-count pill, a button's border), mostly past the
 * finder's box, with all it frames. A framed symbol within the box is still
 * the mark.
 */
export function dropChrome(comps: Comp[], b: Box, R: Box) {
  const within = (p: Box, q: Box) => p[0] >= q[0] && p[1] >= q[1] && p[2] <= q[2] && p[3] <= q[3]
  for (const c of comps) {
    const w = c.box[2] - c.box[0]
    const h = c.box[3] - c.box[1]
    if (w <= 0 || h <= 0 || c.area / (w * h) >= FRAME_FILL) continue
    const x0 = R[0] + c.box[0]
    const x1 = R[0] + c.box[2]
    const past = Math.max(0, Math.min(x1, b[0]) - x0) + Math.max(0, x1 - Math.max(x0, b[2]))
    if (past < FRAME_OUTSIDE * w) continue
    const framed = comps.filter((o) => o !== c && within(o.box, c.box))
    if (!framed.length) continue
    c.drop = true
    for (const o of framed) o.drop = true
  }
}

/**
 * On grain, faint pixels on the far side of the header colour from the ink
 * (black grain on a near-black header behind a white name) are grain the
 * letters' edges touch, not ink: their coverage goes to none. Whether any did.
 */
export function unGrain(
  comps: Comp[],
  a0: Float32Array,
  W: number,
  at: (x: number, y: number) => RGB,
  bg: RGB
): boolean {
  const main = comps.reduce((p, q) => (q.area > p.area ? q : p))
  const m = main.sum.map((v) => v / main.area)
  let changed = false
  for (let i = 0; i < a0.length; i++) {
    if (!(a0[i]! > 0 && a0[i]! < 1)) continue
    const x = i % W
    const p = at(x, (i - x) / W)
    let dot = 0
    for (let ch = 0; ch < 3; ch++) dot += (p[ch]! - bg[ch]!) * (m[ch]! - bg[ch]!)
    if (dot < 0) {
      a0[i] = 0
      changed = true
    }
  }
  return changed
}
