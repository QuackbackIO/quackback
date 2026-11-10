/**
 * Measures on a logo cutout: its colours, whether its outline stands out on
 * a colour (contrast), its shape (aspect, a leading symbol before a name),
 * and how flat the header around it is.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { hex, okDist, type RGB } from './color'
import type { Box } from './kinds'
import type { Image } from './png'
import { frameStats } from './snap'

export interface LogoColour {
  hex: string
  rgb: RGB
  /** Share of the cutout's opaque pixels. */
  share: number
}

export interface LogoGeometry {
  /** Width over height of the mark. */
  aspect: number
  /** A symbol leads, set apart from a name after it. */
  leadingMark: boolean
}

/**
 * A box's frame colour (the quantised mode) and the share of frame pixels
 * near it in OKLab, so JPEG noise on a saturated header still counts as flat.
 */
export function flatFrame(img: Image, b: Box): { colour: RGB; share: number } {
  const { colour } = frameStats(img, b)
  let n = 0
  let near = 0
  const visit = (x: number, y: number) => {
    const o = (y * img.width + x) * 4
    n++
    if (okDist([img.data[o]!, img.data[o + 1]!, img.data[o + 2]!], colour) < 0.05) near++
  }
  for (let x = b[0]; x < b[2]; x++) for (const y of [b[1], b[3] - 1]) visit(x, y)
  for (let y = b[1] + 1; y < b[3] - 1; y++) for (const x of [b[0], b[2] - 1]) visit(x, y)
  return { colour, share: near / Math.max(1, n) }
}

/** The opaque pixels' colours: 4-bit bins, merged within OKLab 0.05, each named by its fullest bin. */
export function paletteOf(img: Image, where: (x: number, y: number) => boolean): LogoColour[] {
  const bins = new Map<number, { n: number; s: [number, number, number] }>()
  let total = 0
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4
    if (img.data[o + 3]! < 250 || !where(i % img.width, Math.floor(i / img.width))) continue
    const r = img.data[o]!
    const g = img.data[o + 1]!
    const bl = img.data[o + 2]!
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (bl >> 4)
    const e = bins.get(k) ?? { n: 0, s: [0, 0, 0] }
    e.n++
    e.s[0] += r
    e.s[1] += g
    e.s[2] += bl
    bins.set(k, e)
    total++
  }
  const sorted = [...bins.values()].sort((p, q) => q.n - p.n)
  const out: { rgb: RGB; n: number }[] = []
  for (const e of sorted) {
    const c: RGB = [e.s[0] / e.n, e.s[1] / e.n, e.s[2] / e.n]
    const near = out.find((o) => okDist(o.rgb, c) < 0.05)
    if (near) near.n += e.n
    else out.push({ rgb: c, n: e.n })
  }
  return out
    .sort((p, q) => q.n - p.n)
    .map((o) => ({
      hex: hex(o.rgb),
      rgb: o.rgb.map(Math.round) as RGB,
      share: o.n / Math.max(1, total),
    }))
    .filter((o) => o.share >= 0.02)
    .slice(0, 6)
}

export const luminance = ([r, g, b]: RGB) => {
  const l = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b)
}
const contrast = (a: RGB, b: RGB) => {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * A logo reads on a colour when almost none of its outline vanishes there: a
 * dark name beside a bright symbol does not read on dark, though the symbol
 * does; a yellow oval inside a blue box reads on white, as the box frames it.
 */
export function reads(outline: LogoColour[], on: RGB): boolean {
  let lost = 0
  for (const p of outline) if (contrast(p.rgb, on) < 1.8) lost += p.share
  return lost <= 0.22
}

/**
 * Aspect of the mark, and whether it starts with a symbol before a name: the
 * cutout's ink columns in runs; a leading run, nearly square, set apart by a
 * gap wider than the letters' and taller than them or in another colour.
 */
export function geometryOf(img: Image, s: number): LogoGeometry {
  const { width: w, height: h, data } = img
  const on = (x: number, y: number) => data[(y * w + x) * 4 + 3]! >= 128
  let y0 = h
  let y1 = -1
  const cols: boolean[] = []
  for (let x = 0; x < w; x++) {
    let any = false
    for (let y = 0; y < h; y++)
      if (on(x, y)) {
        any = true
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    cols.push(any)
  }
  const first = cols.indexOf(true)
  if (first < 0) return { aspect: 1, leadingMark: false }
  const H = y1 - y0 + 1
  const aspect = (cols.lastIndexOf(true) - first + 1) / H
  // Runs of ink columns, joined across hairline gaps.
  const join = Math.max(1 * s, 0.06 * H)
  const runs: [number, number][] = []
  for (let x = 0; x < w; x++) {
    if (!cols[x]) continue
    const last = runs[runs.length - 1]
    if (last && x - last[1] <= join) last[1] = x + 1
    else runs.push([x, x + 1])
  }
  if (runs.length < 3) return { aspect, leadingMark: false }
  const stats = (x0: number, x1: number) => {
    let top = h
    let bottom = -1
    const sum = [0, 0, 0]
    let n = 0
    for (let x = x0; x < x1; x++)
      for (let y = 0; y < h; y++)
        if (on(x, y)) {
          if (y < top) top = y
          if (y > bottom) bottom = y
          const o = (y * w + x) * 4
          sum[0] += data[o]!
          sum[1] += data[o + 1]!
          sum[2] += data[o + 2]!
          n++
        }
    return { h: bottom - top + 1, colour: sum.map((v) => v / Math.max(1, n)) as RGB }
  }
  const lead = runs[0]!
  const rest = runs.slice(1)
  const L = stats(lead[0], lead[1])
  const others = stats(rest[0]![0], rest[rest.length - 1]![1])
  const heights = rest.map((r) => stats(r[0], r[1]).h).sort((p, q) => p - q)
  const gaps = rest
    .slice(1)
    .map((r, i) => r[0] - rest[i]![1])
    .sort((p, q) => p - q)
  const medH = heights[Math.floor(heights.length / 2)]!
  const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0
  const leadGap = rest[0]![0] - lead[1]
  const la = (lead[1] - lead[0]) / Math.max(1, L.h)
  const leadingMark =
    L.h >= 0.55 * H &&
    la >= 0.5 &&
    la <= 1.8 &&
    leadGap >= Math.max(2 * s, 1.3 * medGap) &&
    (L.h >= 1.15 * medH || okDist(L.colour, others.colour) > 0.12)
  return { aspect, leadingMark }
}
