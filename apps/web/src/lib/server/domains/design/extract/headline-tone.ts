/**
 * A two-tone headline: part of it set in a second ink, as a payments site's
 * first sentence in navy and the rest in slate, or a phrase in the brand colour.
 * Read from the ink colours of the headline's lines (or, on one line, its
 * words): the ink of each, as the median of its solid pixels, then split in
 * two runs. The part with the less contrast against the page, or the clearly
 * more colourful one, is the accent; its place (the head or the tail of the
 * headline) and whether it is coloured or muted is what a design can carry.
 *
 * None where the inks agree, where they do not split into two runs or two
 * around a middle (a gradient, colours alternating more often), or on a
 * busy background.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { okDist, oklab, type RGB } from './color'
import type { Box } from './kinds'
import type { Image } from './png'
import { frameStats } from './snap'

export interface HeadlineTone {
  /** The headline's own ink, and its second. */
  main: RGB
  accent: RGB
  /** Where the accent sits: the headline's start or its end. */
  place: 'head' | 'tail'
  /** A colour of its own, or the same hue lighter (closer to the page). */
  style: 'colour' | 'muted'
}

/** Inks closer than this (OKLab) are one; further than SPLIT, two. Between, unsure. */
const SAME = 0.05
const SPLIT = 0.09
/** A column with more than this share off the page colour runs through art, not just words. */
const PAGE_COLUMN = 0.6
/** A pixel this far from the page colour is ink. */
const INK = 0.12
/** Chroma (OKLab) from which an accent is a colour of its own, and how much more it needs than the main ink. */
const COLOURFUL = 0.06
const MORE_COLOURFUL = 0.04

const px = (img: Image, x: number, y: number): RGB => {
  const o = (y * img.width + x) * 4
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
}

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]!
}

/** Runs of indices where `on` holds, gaps up to `gap` bridged, each at least `min` long. */
function runs(on: boolean[], gap: number, min: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = -1
  let last = -1
  on.forEach((v, i) => {
    if (!v) return
    if (start >= 0 && i - last > gap + 1) {
      if (last + 1 - start >= min) out.push([start, last + 1])
      start = i
    } else if (start < 0) start = i
    last = i
  })
  if (start >= 0 && last + 1 - start >= min) out.push([start, last + 1])
  return out
}

/** The ink of a region: the median of its solid pixels (the farthest from the page). */
function inkOf(img: Image, cols: readonly number[], y0: number, y1: number, page: RGB): RGB | null {
  const pts: Array<{ c: RGB; d: number }> = []
  for (let y = y0; y < y1; y++)
    for (const x of cols) {
      const c = px(img, x, y)
      const d = okDist(c, page)
      if (d > INK) pts.push({ c, d })
    }
  if (pts.length < 12) return null
  const far = medianOf(pts.map((p) => p.d)) * 0.9
  const solid = pts.filter((p) => p.d >= far)
  return [0, 1, 2].map((k) => medianOf(solid.map((p) => p.c[k]!))) as RGB
}

const chroma = (c: RGB) => {
  const [, a, b] = oklab(c)
  return Math.hypot(a, b)
}

export function headlineTone(img: Image, box: Box | null): HeadlineTone | null {
  if (!box) return null
  const x0 = Math.max(0, Math.floor(box[0]))
  const y0 = Math.max(0, Math.floor(box[1]))
  const x1 = Math.min(img.width, Math.ceil(box[2]))
  const y1 = Math.min(img.height, Math.ceil(box[3]))
  if (x1 - x0 < 8 || y1 - y0 < 8) return null
  const frame = frameStats(img, [
    Math.max(0, x0 - 3),
    Math.max(0, y0 - 3),
    Math.min(img.width, x1 + 3),
    Math.min(img.height, y1 + 3),
  ])
  if (frame.share < 0.5) return null
  const page = frame.colour
  const inkAt = (x: number, y: number) => okDist(px(img, x, y), page) > INK
  // Columns over the page: text leaves most of a column's pixels page-coloured; a column
  // mostly off the page runs through art or a gradient behind the words (a payments site's ribbon).
  // Art crossing the box diagonally leaves the page at the column's top or bottom: those go too.
  const pageAt = (x: number, y: number) =>
    y < 0 || y >= img.height || okDist(px(img, x, y), page) <= SAME
  const cols: number[] = []
  for (let x = x0; x < x1; x++) {
    if (!pageAt(x, y0 - 2) || !pageAt(x, y1 + 1)) continue
    let off = 0
    for (let y = y0; y < y1; y++) if (okDist(px(img, x, y), page) > SAME) off++
    if (off < (y1 - y0) * PAGE_COLUMN) cols.push(x)
  }
  if (cols.length < (x1 - x0) * 0.3) return null
  // Lines: rows with ink, small gaps bridged (dots and accents), at least 6px tall.
  const rowInk: boolean[] = []
  for (let y = y0; y < y1; y++) {
    let n = 0
    for (const x of cols) if (inkAt(x, y)) n++
    rowInk.push(n >= Math.max(2, cols.length * 0.01))
  }
  const bands = runs(rowInk, 1, 6).map(([a, b]) => [a + y0, b + y0] as const)
  // A headline's lines share a size: a much shorter band is a cut line or other text.
  const tall = medianOf(bands.map(([a, b]) => b - a))
  const lines = bands.filter(([a, b]) => b - a >= tall * 0.6)
  if (!lines.length) return null
  // Two lines or more: each line's ink. One line: each word's (column gaps over a quarter of its height).
  let units: RGB[]
  if (lines.length >= 2) {
    units = lines.flatMap(([a, b]) => {
      const c = inkOf(img, cols, a, b, page)
      return c ? [c] : []
    })
  } else {
    const [a, b] = lines[0]!
    const kept = new Set(cols)
    const colInk: boolean[] = []
    for (let x = x0; x < x1; x++) {
      let on = false
      for (let y = a; y < b && !on && kept.has(x); y++) on = inkAt(x, y)
      colInk.push(on)
    }
    units = runs(colInk, Math.round((b - a) * 0.25), 2).flatMap(([l, r]) => {
      const span = cols.filter((x) => x >= l + x0 && x < r + x0)
      const c = inkOf(img, span, a, b, page)
      return c ? [c] : []
    })
  }
  if (units.length < 2) return null
  // Two runs: the first ink, then from the first unit far from it, the second; nothing
  // between. Or three, the first ink coming back after the second (a support platform's grey lead and
  // tail around a black middle line): still two inks, the second set apart in the middle.
  const first = units[0]!
  const split = units.findIndex((u) => okDist(u, first) >= SPLIT)
  if (split < 0) return null
  const second = units[split]!
  let back = units.length
  for (let i = split; i < units.length; i++)
    if (okDist(units[i]!, second) >= SPLIT / 2) {
      back = i
      break
    }
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!
    const ok = i < split || i >= back ? okDist(u, first) < SAME : okDist(u, second) < SPLIT / 2
    if (!ok) return null
  }
  // The accent: the clearly more colourful ink, else the one closer to the page.
  const colourful = (a: RGB, b: RGB) =>
    chroma(a) >= COLOURFUL && chroma(a) >= chroma(b) + MORE_COLOURFUL
  const secondIsAccent = colourful(second, first)
    ? true
    : colourful(first, second)
      ? false
      : okDist(second, page) < okDist(first, page)
  const [main, accent] = secondIsAccent ? [first, second] : [second, first]
  // Around a middle part, the lighter outer ink leads the headline, so it is carried as its
  // head; a middle part that is the accent is the nearest to a tail.
  return {
    main,
    accent,
    place: secondIsAccent ? 'tail' : 'head',
    style: colourful(accent, main) ? 'colour' : 'muted',
  }
}
