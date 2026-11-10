/**
 * Two places colour evidence reads closely: the logo's field (a shape
 * holding the logo's other colours, as a name on a coloured rectangle) and
 * the current menu item (an item whose colour, pill or underline stands
 * apart from the rest).
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { deltaE00, type RGB } from './color'
import { chromaOf, clampBox, fillAndInk, labDist, labImage, type Swatch } from './colours'
import type { Box } from './kinds'
import type { Image } from './png'
import { solidShapes } from './shapes'

/** A colour that can carry a brand: colourful, and a dark one clearly so (navy text is ink, not a brand colour). */
export const chromatic = (lab: readonly number[]) => chromaOf(lab) >= (lab[0]! < 0.32 ? 0.07 : 0.06)

/**
 * The logo colour that is its field: a solid shape spanning the logo with
 * another of its colours inside (a name on a coloured rectangle), the
 * brand's colour more than the lettering on it.
 */
export function logoField(img: Image, box: Box, colours: Swatch[]): Swatch | null {
  if (colours.length < 2) return null
  const b = clampBox(box, img)
  const L = labImage(img)
  const span = colours.map(() => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1, n: 0 }))
  for (let y = b[1]; y < b[3]; y++)
    for (let x = b[0]; x < b[2]; x++) {
      const i = (y * img.width + x) * 3
      colours.forEach((c, k) => {
        if (Math.hypot(L[i]! - c.lab[0], L[i + 1]! - c.lab[1], L[i + 2]! - c.lab[2]) >= 0.05) return
        const e = span[k]!
        e.n++
        if (x < e.x0) e.x0 = x
        if (x > e.x1) e.x1 = x
        if (y < e.y0) e.y0 = y
        if (y > e.y1) e.y1 = y
      })
    }
  const areaOf = (e: (typeof span)[number]) =>
    e.x1 < 0 ? 0 : (e.x1 - e.x0 + 1) * (e.y1 - e.y0 + 1)
  const all = Math.max(...span.map(areaOf))
  for (let k = 0; k < colours.length; k++) {
    const e = span[k]!
    const a = areaOf(e)
    if (a < 0.8 * all || e.n < 0.3 * a) continue
    const holds = span.some(
      (o, j) => j !== k && o.n > 0 && o.x0 > e.x0 && o.x1 < e.x1 && o.y0 > e.y0 && o.y1 < e.y1
    )
    if (holds) return colours[k]!
  }
  return null
}

/** The current menu item: an item whose colour, pill or underline stands apart from the rest. */
export function activeNavOf(
  img: Image,
  nav: Box,
  u: number
): { rgb: RGB; lab: RGB; style: 'colour' | 'pill' | 'underline' } | null {
  const h = nav[3] - nav[1]
  const row = clampBox([nav[0] - 8 * u, nav[1] - h * 0.6, nav[2] + 8 * u, nav[3] + h * 0.9], img)
  // Pills: a filled shape in the row holding one item's label.
  const pills = solidShapes(img, row, {
    minHeight: Math.max(12, h * 0.9),
    maxHeight: h * 3.2,
    minAspect: 1,
    maxAspect: 10,
  })
  const bg = fillAndInk(img, nav, { mode: 'text' }).fill
  for (const p of pills) {
    if (!bg || labDist(p.fill.lab, bg.lab) < 0.03) continue
    if (chromatic(p.fill.lab) || pills.length === 1)
      return { rgb: p.fill.rgb, lab: p.fill.lab, style: 'pill' }
  }
  // Items: runs of ink columns split by gaps wider than a word space.
  const L = fillAndInk(img, nav, { mode: 'text' })
  if (!L.fill) return null
  const cols: boolean[] = []
  for (let x = nav[0]; x < nav[2]; x++) {
    let ink = false
    for (let y = nav[1]; y < nav[3] && !ink; y++) {
      const o = (y * img.width + x) * 4
      const d = deltaE00([img.data[o]!, img.data[o + 1]!, img.data[o + 2]!], L.fill.rgb)
      if (d > 20) ink = true
    }
    cols.push(ink)
  }
  const gap = Math.max(8 * u, h * 0.6)
  const items: Box[] = []
  let start = -1
  let last = -1
  cols.forEach((ink, i) => {
    if (!ink) return
    if (start < 0 || i - last > gap) {
      if (start >= 0) items.push([nav[0] + start, nav[1], nav[0] + last + 1, nav[3]])
      start = i
    }
    last = i
  })
  if (start >= 0) items.push([nav[0] + start, nav[1], nav[0] + last + 1, nav[3]])
  if (items.length < 3) return null
  const inks = items.map((b) => fillAndInk(img, b, { mode: 'text' }).ink)
  const coloured = inks.filter((s) => s && chromatic(s.lab)) as Swatch[]
  const plain = inks.filter((s) => s && chromaOf(s.lab) < 0.06)
  if (coloured.length === 1 && plain.length >= 2) {
    const c = coloured[0]!
    return { rgb: c.rgb, lab: c.lab, style: 'colour' }
  }
  // Underline: a line under one item only.
  for (const b of items) {
    const under = clampBox([b[0], b[3] + 2 * u, b[2], b[3] + h * 0.9], img)
    const line = fillAndInk(img, under)
    if (!line.ink || line.contrast < 0.15) continue
    const others = items.filter((o) => o !== b)
    const alone = others.every((o) => {
      const r = fillAndInk(img, clampBox([o[0], o[3] + 2 * u, o[2], o[3] + h * 0.9], img))
      return !r.ink || r.contrast < 0.15
    })
    if (alone) return { rgb: line.ink.rgb, lab: line.ink.lab, style: 'underline' }
  }
  return null
}

export function hexRgb(h: string): RGB {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

/** WCAG contrast of two colours. */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = hexRgb(h).map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
