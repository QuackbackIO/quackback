/**
 * Corner radius and the edge outside a box, inside the finder's snapped boxes
 * (buttons and cards measured apart): the radius by fitting the shape's
 * boundary along each corner to a circle, and a 1px border, a shadow, or
 * nothing from the edge profile across each side.
 *
 * Every length comes back in CSS px: image px over `scale` (2 for a retina
 * capture, 1024/1440 for a 1440px page sent at 1024).
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { okDist, oklab, type RGB } from './color'
import type { Image } from './png'
import { along, clampBox, median, medianColour, px, type GeometryOptions } from './pixels'
import { frameStats } from './snap'

export type { GeometryOptions }

// Corner radius

export interface Corners {
  /** Radius in CSS px; half the height for a pill. */
  radius: number
  pill: boolean
  /** The four corners' own fits (top left, top right, bottom right, bottom left), CSS px. */
  corners: number[]
  /** The shape's measured size, CSS px. */
  width: number
  height: number
  /** The colour of the shape's edge (its fill, or its outline) and of what is around it. */
  edge: RGB
  outside: RGB
}

/** Inset of a circular corner of radius r at distance v from the straight edge. */
const arc = (r: number, v: number) => (v < r ? r - Math.sqrt(Math.max(0, r * r - (r - v) ** 2)) : 0)

/**
 * Corner radius of a filled or outlined shape (a button, a card, a field):
 * its straight edges found to a fraction of a pixel, then along each corner
 * the inset of the shape's boundary row by row, fitted to a circle. The
 * radius is the median of the four corners' fits, so one corner hidden by a
 * neighbour or a shadow does not move it.
 */
export function cornerRadius(
  img: Image,
  box: readonly number[] | null,
  opts: GeometryOptions = {}
): Corners | null {
  if (!box) return null
  const s = opts.scale ?? 1
  const b = clampBox(box, img)
  if (b[2] - b[0] < 6 || b[3] - b[1] < 6) return null
  const m = Math.round(4 * s) + 2
  const R = clampBox([b[0] - m, b[1] - m, b[2] + m, b[3] + m], img)
  const outside = frameStats(img, R).colour
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  // The shape's edge colour: the sample just inside a side that is farthest from the outside.
  const probes: RGB[] = []
  for (let k = -2; k <= 3; k++) {
    probes.push(px(img, b[0] + k, cy), px(img, b[2] - 1 - k, cy))
    probes.push(px(img, cx, b[1] + k), px(img, cx, b[3] - 1 - k))
  }
  const edge = probes.reduce((best, p) => (okDist(p, outside) > okDist(best, outside) ? p : best))
  if (okDist(edge, outside) < 0.03) return null
  const a = (x: number, y: number) => along(px(img, x, y), outside, edge)
  // Distance from a start pixel's outer side, along a direction, to where the shape's
  // coverage crosses one half (interpolated between pixel centres: exact for a straight
  // anti-aliased edge, and the outer side of a thin outline).
  const run = (x: number, y: number, dx: number, dy: number, limit: number) => {
    let prev = 0
    for (let i = 0; i < limit; i++) {
      const v = a(x + dx * i, y + dy * i)
      if (v >= 0.5) return i - 0.5 + (0.5 - prev) / Math.max(1e-6, v - prev)
      prev = v
    }
    return null
  }
  const W = R[2] - R[0]
  const H = R[3] - R[1]
  const sideEdge = (side: 'l' | 'r' | 't' | 'b') => {
    const vals: number[] = []
    const horizontal = side === 'l' || side === 'r'
    const lo = horizontal ? b[1] + 0.3 * (b[3] - b[1]) : b[0] + 0.3 * (b[2] - b[0])
    const hi = horizontal ? b[1] + 0.7 * (b[3] - b[1]) : b[0] + 0.7 * (b[2] - b[0])
    for (let t = Math.round(lo); t <= Math.round(hi); t++) {
      const v =
        side === 'l'
          ? run(R[0], t, 1, 0, W)
          : side === 'r'
            ? run(R[2] - 1, t, -1, 0, W)
            : side === 't'
              ? run(t, R[1], 0, 1, H)
              : run(t, R[3] - 1, 0, -1, H)
      if (v !== null) vals.push(v)
    }
    if (!vals.length) return null
    const d = median(vals)
    return side === 'l' ? R[0] + d : side === 'r' ? R[2] - d : side === 't' ? R[1] + d : R[3] - d
  }
  // A side at the image's edge is cut off there: the shape runs on past it.
  const cut = { l: b[0] <= 0, t: b[1] <= 0, r: b[2] >= img.width, b: b[3] >= img.height }
  const el = cut.l ? 0 : sideEdge('l')
  const er = cut.r ? img.width : sideEdge('r')
  const et = cut.t ? 0 : sideEdge('t')
  const eb = cut.b ? img.height : sideEdge('b')
  if (el === null || er === null || et === null || eb === null) return null
  const w = er - el
  const h = eb - et
  if (w < 4 || h < 4) return null
  const K = Math.floor(Math.min(w, h) / 2)
  const fits: number[] = []
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ] as const) {
    // A corner cut off by the image's edge cannot be read.
    if ((sx > 0 ? cut.l : cut.r) || (sy > 0 ? cut.t : cut.b)) continue
    const pts: Array<[number, number]> = []
    for (let k = 0; k < K; k++) {
      // Rows (from the top or bottom edge inward) and their inset from the left or right edge.
      const y = sy > 0 ? Math.ceil(et) + k : Math.floor(eb) - 1 - k
      const v = sy > 0 ? y + 0.5 - et : eb - (y + 0.5)
      if (v <= 0) continue
      const startX = sx > 0 ? R[0] : R[2] - 1
      const r = run(startX, y, sx, 0, Math.ceil(w / 2) + m)
      if (r === null) continue
      const pos = sx > 0 ? R[0] + r : R[2] - r
      pts.push([v, sx > 0 ? pos - el : er - pos])
    }
    if (pts.length < 2) continue
    let best = 0
    let bestErr = Infinity
    for (let r = 0; r <= K + 0.001; r += 0.25) {
      let err = 0
      for (const [v, inset] of pts) err += (inset - arc(r, v)) ** 2
      if (err < bestErr) {
        bestErr = err
        best = r
      }
    }
    fits.push(best)
  }
  if (!fits.length) return null
  let radius = median(fits)
  const pill = radius >= 0.45 * Math.min(w, h)
  if (pill) radius = Math.min(w, h) / 2
  return {
    radius: radius / s,
    pill,
    corners: fits.map((f) => f / s),
    width: w / s,
    height: h / s,
    edge,
    outside,
  }
}

// Border or shadow

export interface EdgeStyle {
  /** What marks the box off from the page: a thin line, a shadow, or nothing. */
  kind: 'border' | 'shadow' | 'none'
  /** The box's own colour, a little inside its edge. */
  inside: RGB
  /** The page's colour, a little outside it. */
  outside: RGB
  /** The box has its own fill, unlike the page around it. */
  filled: boolean
  border: { colour: RGB; width: number } | null
  /** How far the shadow reaches below the box, CSS px. */
  shadow: { depth: number } | null
}

/**
 * The edge profile across each side of a box, from a little inside to a
 * little outside (median over the middle of the side). A border is a thin
 * run off the line between inside and outside (not just their blend at an
 * anti-aliased edge); a shadow is a run outside, below or around the box,
 * darker than the page and fading into it.
 */
export function edgeStyle(
  img: Image,
  box: readonly number[] | null,
  opts: GeometryOptions = {}
): EdgeStyle | null {
  if (!box) return null
  const s = opts.scale ?? 1
  const b = clampBox(box, img)
  if (b[2] - b[0] < 8 || b[3] - b[1] < 8) return null
  const IN = Math.max(4, Math.round(6 * s))
  const OUT = Math.max(8, Math.round(14 * s))
  type Side = 'l' | 'r' | 't' | 'b'
  // Offset d: d <= 0 is the pixel -d inside the edge, d >= 1 the pixel d - 1 outside it.
  const at = (side: Side, t: number, d: number): RGB =>
    side === 'l'
      ? px(img, b[0] - d, t)
      : side === 'r'
        ? px(img, b[2] - 1 + d, t)
        : side === 't'
          ? px(img, t, b[1] - d)
          : px(img, t, b[3] - 1 + d)
  const inImage = (side: Side) =>
    side === 'l'
      ? b[0] - OUT >= 0
      : side === 'r'
        ? b[2] - 1 + OUT < img.width
        : side === 't'
          ? b[1] - OUT >= 0
          : b[3] - 1 + OUT < img.height
  const profiles: Partial<Record<Side, RGB[]>> = {}
  for (const side of ['l', 'r', 't', 'b'] as const) {
    if (!inImage(side)) continue
    const horizontal = side === 'l' || side === 'r'
    const lo = horizontal ? b[1] + 0.25 * (b[3] - b[1]) : b[0] + 0.25 * (b[2] - b[0])
    const hi = horizontal ? b[1] + 0.75 * (b[3] - b[1]) : b[0] + 0.75 * (b[2] - b[0])
    const step = Math.max(1, Math.round((hi - lo) / 24))
    const prof: RGB[] = []
    for (let d = -IN; d <= OUT; d++) {
      const cs: RGB[] = []
      for (let t = Math.round(lo); t <= Math.round(hi); t += step) cs.push(at(side, t, d))
      prof.push(medianColour(cs))
    }
    profiles[side] = prof
  }
  const sides = Object.keys(profiles) as Side[]
  if (!sides.length) return null
  const P = (side: Side, d: number) => profiles[side]![d + IN]!
  const inside = medianColour(sides.flatMap((sd) => [P(sd, -IN), P(sd, -IN + 1), P(sd, -IN + 2)]))
  const outside = medianColour(sides.flatMap((sd) => [P(sd, OUT), P(sd, OUT - 1), P(sd, OUT - 2)]))
  const filled = okDist(inside, outside) > 0.025
  // Distance in OKLab from the segment between inside and outside.
  const io = [oklab(inside), oklab(outside)] as const
  const offLine = (c: RGB) => {
    const p = oklab(c)
    const [A, B] = io
    const v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
    const vv = v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2
    const t =
      vv > 0
        ? Math.min(
            1,
            Math.max(
              0,
              ((p[0] - A[0]) * v[0]! + (p[1] - A[1]) * v[1]! + (p[2] - A[2]) * v[2]!) / vv
            )
          )
        : 0
    return Math.hypot(p[0] - A[0] - t * v[0]!, p[1] - A[1] - t * v[1]!, p[2] - A[2] - t * v[2]!)
  }
  // Border: on most sides, a run of at most 2 CSS px near the edge that is off the line.
  const maxW = Math.max(2, Math.round(2 * s) + 1)
  let borderSides = 0
  const borderColours: RGB[] = []
  const widths: number[] = []
  for (const sd of sides) {
    let runStart = -1
    let found: { w: number; c: RGB } | null = null
    for (let d = -3; d <= 4; d++) {
      const off = offLine(P(sd, d)) > 0.02
      if (off && runStart < 0) runStart = d
      if ((!off || d === 4) && runStart >= 0) {
        const end = off ? d + 1 : d
        const w = end - runStart
        if (w <= maxW) {
          let far = P(sd, runStart)
          for (let k = runStart; k < end; k++) if (offLine(P(sd, k)) > offLine(far)) far = P(sd, k)
          found = { w, c: far }
        }
        runStart = -1
        break
      }
    }
    if (found) {
      borderSides++
      borderColours.push(found.c)
      widths.push(found.w)
    }
  }
  const border =
    borderSides >= Math.min(3, sides.length) && borderSides >= 2
      ? { colour: medianColour(borderColours), width: Math.max(1, Math.round(median(widths) / s)) }
      : null
  // Shadow: outside the box (past any border), a run darker than the page that fades into it.
  const L = (c: RGB) => oklab(c)[0]
  const Lout = L(outside)
  const shadowRun = (sd: Side) => {
    let n = 0
    let last = 0
    for (let d = 1; d <= OUT - 3; d++) {
      const drop = Lout - L(P(sd, d))
      if (drop > 0.006) {
        n++
        last = d
      } else if (n > 0 && d > last + 1) break
    }
    return n >= Math.max(3, Math.round(3 * s)) ? last : 0
  }
  let below = profiles.b ? shadowRun('b') : 0
  // A shadow still darkening the page where the profile ends goes on further: follow it down.
  if (below >= OUT - 4) below = Math.max(below, deepShadow(img, b, s))
  const around = sides.filter((sd) => sd !== 'b' && shadowRun(sd) > 0).length
  const shadow = below > 0 || around >= 2 ? { depth: Math.max(below, 1) / s } : null
  return {
    kind: shadow ? 'shadow' : border ? 'border' : 'none',
    inside,
    outside,
    filled,
    border,
    shadow,
  }
}

/** How far below a box a deep shadow is followed, CSS px. */
const DEEP = 64

/**
 * How far a shadow reaches below a box, in image px, followed past the edge
 * profile: down the middle half of the box's width, against the page's
 * colour at the probe's far end, while each row stays a little darker than
 * it and keeps fading (a row darkening again past the faintest is something
 * else, such as text or the next card). A floating card's shadow reaches 15 to 60px
 * where the profile stops at 11.
 */
function deepShadow(img: Image, b: readonly number[], s: number): number {
  const far = Math.min(img.height - 1, b[3]! - 1 + Math.round(DEEP * s))
  const lo = Math.round(b[0]! + 0.25 * (b[2]! - b[0]!))
  const hi = Math.round(b[0]! + 0.75 * (b[2]! - b[0]!))
  const step = Math.max(1, Math.round((hi - lo) / 24))
  const row = (y: number) => {
    const cs: RGB[] = []
    for (let x = lo; x <= hi; x += step) cs.push(px(img, x, y))
    return oklab(medianColour(cs))[0]
  }
  const page = row(far)
  let last = 0
  let least = Infinity
  for (let d = 1; b[3]! - 1 + d < far; d++) {
    const drop = page - row(b[3]! - 1 + d)
    // Fading out, or darkening again past its faintest (something below it).
    if (drop <= 0.003 || drop > least + 0.01) break
    least = Math.min(least, drop)
    last = d
  }
  return last
}
