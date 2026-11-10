/**
 * Spacing and width from pixels: ink-free bands, the gap under a headline
 * (or, on busy pixels, between its box and the next box under it), a card's
 * padding, and the content's width from the header's ink.
 *
 * Every length comes back in CSS px. Pure: no app imports.
 */
import { okDist, type RGB } from './color'
import type { Box } from './kinds'
import type { Image } from './png'
import { clampBox, medianColour, px, type GeometryOptions } from './pixels'
import { frameStats } from './snap'

// Spacing and width

/**
 * Whether a row of the image is free of ink across [x0, x1): no sharp change
 * between neighbouring samples, allowing a few (art or a photo's edge at one side).
 */
function blankRow(img: Image, y: number, x0: number, x1: number, step: number, allow = 0): boolean {
  const cs: RGB[] = []
  for (let x = x0; x < x1; x += step) cs.push(px(img, x, y))
  const ref = medianColour(cs)
  let inked = 0
  for (let i = 0; i < cs.length; i++) {
    // Ink: a sharp change from the sample before, or a colour well off the row's own.
    if ((i > 0 && okDist(cs[i]!, cs[i - 1]!) > 0.03) || okDist(cs[i]!, ref) > 0.06) inked++
  }
  return inked <= allow * cs.length
}

/**
 * Ink-free bands: runs of rows with no sharp change across the columns
 * [x0, x1), at least `min` CSS px tall, in CSS px from the image top.
 */
export function inkFreeBands(
  img: Image,
  region: readonly number[],
  opts: GeometryOptions & { min?: number } = {}
): Array<[number, number]> {
  const s = opts.scale ?? 1
  const r = clampBox(region, img)
  const step = Math.max(1, Math.round(2 * s))
  const out: Array<[number, number]> = []
  let start = -1
  for (let y = r[1]; y <= r[3]; y++) {
    const blank = y < r[3] && blankRow(img, y, r[0], r[2], step)
    if (blank && start < 0) start = y
    if (!blank && start >= 0) {
      if (y - start >= (opts.min ?? 8) * s) out.push([start / s, y / s])
      start = -1
    }
  }
  return out
}

/**
 * The ink-free gap under a box (a headline), down to the next ink across the
 * same columns, in CSS px; null when the image ends first.
 */
export function gapBelow(
  img: Image,
  box: readonly number[] | null,
  opts: GeometryOptions = {}
): number | null {
  if (!box) return null
  const s = opts.scale ?? 1
  const b = clampBox(box, img)
  const step = Math.max(1, Math.round(2 * s))
  const x0 = b[0]
  const x1 = Math.max(b[0] + 4, b[2])
  const blank = (y: number) => blankRow(img, y, x0, x1, step, 0.03)
  // The box's foot may hold a descender's last anti-aliased row: start at the first blank row.
  let y = b[3]
  const lead = y + Math.max(2, Math.round(3 * s))
  while (y < Math.min(img.height, lead) && !blank(y)) y++
  // No blank row under it: the headline sits on a photo or busy art, where gaps cannot be read.
  if (y >= lead || y >= img.height) return null
  const start = y
  while (y < img.height && blank(y)) y++
  if (y >= img.height) return null
  return (y - start) / s
}

/**
 * The gap from a box (a headline) down to the nearest of the boxes under it
 * that share its columns (a subtitle, a button), in CSS px; null when none
 * is under it. For when the pixels under the headline are too busy to read.
 */
export function boxGap(
  upper: readonly number[] | null,
  lowers: ReadonlyArray<readonly number[] | null>,
  opts: GeometryOptions = {}
): number | null {
  if (!upper) return null
  const s = opts.scale ?? 1
  const tops = lowers
    .filter(
      (b): b is readonly number[] =>
        !!b && b[1]! >= upper[3]! - 2 && b[0]! < upper[2]! && b[2]! > upper[0]!
    )
    .map((b) => b[1]! - upper[3]!)
  return tops.length ? Math.max(0, Math.min(...tops)) / s : null
}

/**
 * A card's padding: the ink-free margin from its edges to its content, the
 * smaller of the left and top margins, in CSS px; null when the card shows
 * no content.
 */
export function cardPadding(
  img: Image,
  box: readonly number[] | null,
  opts: GeometryOptions = {}
): number | null {
  if (!box) return null
  const s = opts.scale ?? 1
  const b = clampBox(box, img)
  if (b[2] - b[0] < 16 || b[3] - b[1] < 16) return null
  // Skip the card's own edge (border, anti-aliased corner) before looking for content.
  const skip = Math.max(2, Math.round(3 * s))
  const inner: Box = [b[0] + skip, b[1] + skip, b[2] - skip, b[3] - skip]
  const fill = frameStats(img, inner).colour
  const has = (x: number, y: number) => okDist(px(img, x, y), fill) > 0.08
  let left = -1
  for (let x = inner[0]; x < inner[2] && left < 0; x++)
    for (let y = inner[1]; y < inner[3]; y += 1)
      if (has(x, y)) {
        left = x
        break
      }
  let top = -1
  for (let y = inner[1]; y < inner[3] && top < 0; y++)
    for (let x = inner[0]; x < inner[2]; x += 1)
      if (has(x, y)) {
        top = y
        break
      }
  const ms = [left >= 0 ? left - b[0] : -1, top >= 0 ? top - b[1] : -1].filter((v) => v > skip)
  return ms.length ? Math.min(...ms) / s : null
}

/**
 * The content's horizontal extent in CSS px: the outermost columns with ink
 * in the header band (the site's container: logo on the left, buttons on
 * the right), else the union of the element boxes given.
 */
export function contentExtent(
  img: Image,
  header: readonly number[] | null,
  boxes: ReadonlyArray<readonly number[] | null>,
  opts: GeometryOptions = {}
): { left: number; right: number; width: number; ratio: number } | null {
  const s = opts.scale ?? 1
  let l = Infinity
  let r = -Infinity
  if (header) {
    const h = clampBox(header, img)
    const bg = frameStats(img, h).colour
    const ink = (x: number) => {
      for (let y = h[1] + 1; y < h[3] - 1; y += 1) if (okDist(px(img, x, y), bg) > 0.1) return true
      return false
    }
    for (let x = h[0] + 1; x < h[2] - 1 && l === Infinity; x++) if (ink(x)) l = x
    for (let x = h[2] - 2; x > h[0] && r === -Infinity; x--) if (ink(x)) r = x + 1
  }
  if (l === Infinity || r - l < img.width * 0.2) {
    for (const b of boxes) {
      if (!b) continue
      l = Math.min(l, b[0]!)
      r = Math.max(r, b[2]!)
    }
  }
  if (!Number.isFinite(l) || !Number.isFinite(r) || r <= l) return null
  return { left: l / s, right: r / s, width: (r - l) / s, ratio: (r - l) / img.width }
}
