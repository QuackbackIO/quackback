/**
 * Box snapping: move a model's loose box to the element's real edges by
 * colour discontinuity, within a margin. Pure functions over RGBA pixels.
 *
 * Objects (logo, text, buttons, fields, cards, screenshots): estimate the
 * background from the frame of the search region, mark pixels that differ
 * from it, then move each edge to the outermost foreground row or column that
 * connects to the box (across gaps up to a tolerance). Regions (header,
 * hero): full width when the box nearly is, and top and bottom moved to the
 * strongest horizontal edge (a line where most columns change colour) nearby.
 */
import { okDist, type RGB } from './color'
import type { Box, BoxKind } from './kinds'
import type { Image } from './png'

const px = (img: Image, x: number, y: number): RGB => {
  const o = (y * img.width + x) * 4
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
}

const clampBox = (b: readonly number[], img: Image): Box => [
  Math.max(0, Math.round(b[0]!)),
  Math.max(0, Math.round(b[1]!)),
  Math.min(img.width, Math.round(b[2]!)),
  Math.min(img.height, Math.round(b[3]!)),
]

/** Intersection over union of two boxes; 0 when either is missing. */
export function iou(
  a: readonly number[] | null | undefined,
  b: readonly number[] | null | undefined
): number {
  if (!a || !b) return 0
  const ix = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!))
  const iy = Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!))
  const i = ix * iy
  const u = (a[2]! - a[0]!) * (a[3]! - a[1]!) + (b[2]! - b[0]!) * (b[3]! - b[1]!) - i
  return u > 0 ? i / u : 0
}

/**
 * The dominant colour of a box's 2px frame (quantised mode, then the mean of
 * that bin) and its share of the frame. A low share means a photo, a gradient
 * or busy art.
 */
export function frameStats(img: Image, b: Box): { colour: RGB; share: number } {
  const bins = new Map<number, { n: number; s: [number, number, number] }>()
  const add = (x: number, y: number) => {
    const c = px(img, x, y)
    const k = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3)
    const e = bins.get(k) ?? { n: 0, s: [0, 0, 0] }
    e.n++
    e.s[0] += c[0]
    e.s[1] += c[1]
    e.s[2] += c[2]
    bins.set(k, e)
  }
  const [x0, y0, x1, y1] = b
  for (let x = x0; x < x1; x++) {
    for (const y of [y0, y0 + 1, y1 - 2, y1 - 1]) if (y >= 0 && y < img.height) add(x, y)
  }
  for (let y = y0; y < y1; y++) {
    for (const x of [x0, x0 + 1, x1 - 2, x1 - 1]) if (x >= 0 && x < img.width) add(x, y)
  }
  let best: { n: number; s: [number, number, number] } = { n: 0, s: [255, 255, 255] }
  let total = 0
  for (const e of bins.values()) {
    total += e.n
    if (e.n > best.n) best = e
  }
  const n = Math.max(1, best.n)
  return {
    colour: [best.s[0] / n, best.s[1] / n, best.s[2] / n],
    share: best.n / Math.max(1, total),
  }
}

/**
 * Foreground mask for a region: pixels unlike the background colour, or, on a
 * busy background (photo, gradient), pixels on a sharp local edge.
 */
function foreground(img: Image, R: Box, thr: number) {
  const { colour: bg, share } = frameStats(img, R)
  const busy = share < 0.5
  const W = R[2] - R[0]
  const H = R[3] - R[1]
  const fg = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = px(img, R[0] + x, R[1] + y)
      if (!busy) {
        fg[y * W + x] = okDist(p, bg) > thr ? 1 : 0
        continue
      }
      const r = x + 1 < W ? px(img, R[0] + x + 1, R[1] + y) : p
      const d = y + 1 < H ? px(img, R[0] + x, R[1] + y + 1) : p
      fg[y * W + x] = okDist(p, r) > 0.12 || okDist(p, d) > 0.12 ? 1 : 0
    }
  }
  return { fg, W, H, busy }
}

/** Shrink a box to the ink inside it (never grows). For text and logo boxes. */
export function shrinkToInk(img: Image, box: readonly number[] | null, thr = 0.07): Box | null {
  if (!box) return null
  const b = clampBox(box, img)
  if (b[2] - b[0] < 3 || b[3] - b[1] < 3) return b
  const R = clampBox([b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2], img)
  const { fg, W, H, busy } = foreground(img, R, thr)
  if (busy) return b
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = b[1] - R[1]; y < b[3] - R[1]; y++) {
    for (let x = b[0] - R[0]; x < b[2] - R[0]; x++) {
      if (!fg[y * W + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return b
  return [R[0] + x0, R[1] + y0, R[0] + x1 + 1, R[1] + y1 + 1]
}

export interface SnapOptions {
  /** Device scale of the image (1, or 2 for a retina capture); found from the width when left out. */
  scale?: number
  /** OKLab distance from the background that counts as foreground. */
  threshold?: number
}

interface KindRule {
  region?: boolean
  shrinkX?: boolean
  textRuns?: boolean
  gapX: number
  gapY: number
  marginX: number
  marginY: number
}

/** Per-kind tolerances in CSS px (times the image scale). Gaps let text lines and menu items join. */
const RULES: Record<BoxKind, KindRule> = {
  logo: { gapX: 14, gapY: 6, marginX: 24, marginY: 12 },
  nav_row: { shrinkX: true, textRuns: true, gapX: 0, gapY: 4, marginX: 30, marginY: 16 },
  headline: { textRuns: true, gapX: 24, gapY: 18, marginX: 40, marginY: 28 },
  subtitle: { textRuns: true, gapX: 14, gapY: 10, marginX: 30, marginY: 14 },
  section_heading: { textRuns: true, gapX: 20, gapY: 14, marginX: 30, marginY: 16 },
  primary_button: { gapX: 1, gapY: 1, marginX: 24, marginY: 12 },
  secondary_button: { gapX: 1, gapY: 1, marginX: 24, marginY: 12 },
  link: { textRuns: true, gapX: 10, gapY: 4, marginX: 20, marginY: 8 },
  card: { gapX: 4, gapY: 4, marginX: 40, marginY: 40 },
  input_field: { gapX: 1, gapY: 1, marginX: 24, marginY: 12 },
  product_screenshot: { gapX: 6, gapY: 6, marginX: 60, marginY: 60 },
  header: { region: true, gapX: 0, gapY: 0, marginX: 0, marginY: 16 },
  hero: { region: true, gapX: 0, gapY: 0, marginX: 0, marginY: 32 },
}

/** The image's device scale guessed from its width: 2 for a retina capture (2400px or wider). */
export function scaleOf(img: { width: number }): number {
  return img.width >= 2400 ? 2 : 1
}

/** A loose box moved to the element's real edges; the box itself when snapping is implausible. */
export function snapBox(
  img: Image,
  kind: BoxKind,
  box: Box | null,
  opts: SnapOptions = {}
): Box | null {
  if (!box) return null
  const s = opts.scale ?? scaleOf(img)
  const rule = RULES[kind]
  const b = clampBox(box, img)
  if (b[2] - b[0] < 2 || b[3] - b[1] < 2) return box
  return rule.region
    ? snapRegion(img, b, rule, s)
    : snapObject(img, b, rule, s, opts.threshold ?? 0.07)
}

function snapObject(img: Image, b: Box, rule: KindRule, s: number, thr: number): Box {
  const w = b[2] - b[0]
  const h = b[3] - b[1]
  const mx = Math.round(Math.min(rule.marginX * s, Math.max(4 * s, w * 0.3)))
  const my = Math.round(Math.min(rule.marginY * s, Math.max(4 * s, h * 0.5)))
  const R = clampBox([b[0] - mx, b[1] - my, b[2] + mx, b[3] + my], img)
  const { fg, W, H, busy } = foreground(img, R, thr)
  // Edges in region-local coordinates.
  let l = b[0] - R[0]
  let t = b[1] - R[1]
  let r = b[2] - R[0]
  let btm = b[3] - R[1]
  const colHas = (x: number, y0: number, y1: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) if (fg[y * W + x]) return true
    return false
  }
  const rowHas = (y: number, x0: number, x1: number) => {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) if (fg[y * W + x]) return true
    return false
  }
  // On a busy background, or for kinds that only tighten, edges may move inward only.
  const gx = busy || rule.shrinkX ? -1 : Math.round(rule.gapX * s)
  const gy = busy ? -1 : Math.round(rule.gapY * s)
  // Growth is capped: a model box is usually close, and long growth runs into neighbours and gradients.
  const capX = Math.round(Math.max(4 * s, 0.06 * w))
  const capY = Math.round(Math.max(4 * s, 0.12 * h))
  for (let pass = 0; pass < 2; pass++) {
    // An edge may move inward as far as the opposite edge (ink can sit in one half of a loose box).
    const nl = edge(l, -1, (x) => colHas(x, t, btm), 0, W, gx, r, capX)
    const nr = edge(Math.min(W - 1, r - 1), 1, (x) => colHas(x, t, btm), 0, W, gx, l - 1, capX) + 1
    l = nl
    r = nr
    // On busy backgrounds only single-line kinds (menus, links) look for text runs; a headline on a photo keeps its box.
    if (rule.textRuns && (!busy || rule.shrinkX || rule.gapY <= 4)) {
      const pick = textRun(H, (y) => rowHas(y, l, r), gy, t, btm)
      // On a busy background ink edges are everywhere: accept only a run no taller than 1.6 times the box.
      if (pick && (!busy || pick[1] - pick[0] <= 1.6 * (btm - t))) {
        t = Math.max(pick[0], t - capY)
        btm = Math.min(pick[1], btm + capY)
      }
    } else {
      const nt = edge(t, -1, (y) => rowHas(y, l, r), 0, H, gy, btm, capY)
      const nb =
        edge(Math.min(H - 1, btm - 1), 1, (y) => rowHas(y, l, r), 0, H, gy, t - 1, capY) + 1
      t = nt
      btm = nb
    }
  }
  const out: Box = [R[0] + l, R[1] + t, R[0] + r, R[1] + btm]
  // Refuse implausible snaps: keep the model's box.
  const a0 = w * h
  const a1 = (out[2] - out[0]) * (out[3] - out[1])
  if (a1 <= 0 || a1 < a0 * 0.15 || a1 > a0 * 4 || iou(out, b) < 0.2) return b
  return out
}

/**
 * One edge of a box moved along an axis. From the start line: with ink there,
 * grow outward across gaps up to `gap` (unless ink at the edge is cut off
 * from the inside by a wide gap, which makes it a neighbour); without ink,
 * shrink inward to the first line with ink.
 */
function edge(
  start: number,
  dir: 1 | -1,
  has: (i: number) => boolean,
  lo: number,
  hi: number,
  gap: number,
  limitInward: number,
  cap: number
): number {
  const inward = (j: number) => (dir < 0 ? j < limitInward : j > limitInward)
  if (has(start) && gap < 0) return start
  if (has(start)) {
    let gapRun = 0
    for (let j = start; inward(j); j -= dir) {
      if (has(j)) {
        if (gapRun > Math.max(gap, 2)) return j
        gapRun = 0
      } else gapRun++
    }
    let last = start
    gapRun = 0
    for (let j = start + dir; j >= lo && j < hi && Math.abs(j - start) <= cap; j += dir) {
      if (has(j)) {
        last = j
        gapRun = 0
      } else if (++gapRun > gap) break
    }
    return last
  }
  for (let j = start; inward(j); j -= dir) if (has(j)) return j
  return start
}

/**
 * Text: rows with ink form runs (lines joined across gaps up to `gap`), lines
 * of one block are joined, and the run that best overlaps the box wins.
 */
function textRun(
  H: number,
  rowHas: (y: number) => boolean,
  gap: number,
  t: number,
  btm: number
): [number, number] | null {
  const runs: [number, number][] = []
  let start = -1
  let lastInk = -1
  for (let y = 0; y < H; y++) {
    if (!rowHas(y)) continue
    if (start < 0 || y - lastInk - 1 > gap) {
      if (start >= 0) runs.push([start, lastInk + 1])
      start = y
    }
    lastInk = y
  }
  if (start >= 0) runs.push([start, lastInk + 1])
  // Lines of one block: join runs whose gap is under 0.6 times the smaller line (large type has large gaps).
  for (let i = runs.length - 1; i > 0; i--) {
    const a = runs[i - 1]!
    const b = runs[i]!
    if (b[0] - a[1] < 0.6 * Math.min(a[1] - a[0], b[1] - b[0])) runs.splice(i - 1, 2, [a[0], b[1]])
  }
  const overlap = (a: [number, number]) => Math.min(a[1], btm) - Math.max(a[0], t)
  const centre = (t + btm) / 2
  const mid = (a: [number, number]) => Math.abs((a[0] + a[1]) / 2 - centre)
  const pick = runs.sort((a, b) => overlap(b) - overlap(a) || mid(a) - mid(b))[0]
  return pick && overlap(pick) > -(btm - t) ? pick : null
}

function snapRegion(img: Image, b: Box, rule: KindRule, s: number): Box {
  const out: Box = [...b]
  // Full width only when the box already touches both sides (an inset hero keeps its edges).
  if (b[0] <= img.width * 0.02 && b[2] >= img.width * 0.98) {
    out[0] = 0
    out[2] = img.width
  }
  const step = 4 * s
  // Share of sampled columns whose colour changes across row y (a horizontal edge).
  const strength = (y: number) => {
    if (y < 2 || y > img.height - 2) return 0
    let n = 0
    let hit = 0
    for (let x = out[0] + 2; x < out[2] - 2; x += step) {
      n++
      if (okDist(px(img, x, y - 2), px(img, x, y + 1)) > 0.04) hit++
    }
    return n ? hit / n : 0
  }
  const best = (pred: number, lo: number, hi: number) => {
    let by = pred
    let bs = 0
    for (let y = Math.max(2, lo); y <= Math.min(img.height - 2, hi); y++) {
      const v = strength(y) - (0.15 * Math.abs(y - pred)) / (rule.marginY * s)
      if (v > bs) {
        bs = v
        by = y
      }
    }
    return bs >= 0.35 ? by : pred
  }
  const m = Math.round(Math.min(rule.marginY * s, (b[3] - b[1]) * 0.3))
  out[1] = b[1] <= 20 * s ? 0 : best(b[1], b[1] - m, b[1] + m)
  out[3] = b[3] >= img.height - 20 * s ? img.height : best(b[3], b[3] - m, b[3] + m)
  if (out[3] - out[1] < 8 * s) return b
  return out
}
