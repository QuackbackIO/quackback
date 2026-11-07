/**
 * What screenshots of a brand's site show, read in the browser before they
 * are sent: whether one was taken under a pop-up's dimming layer, so a clean
 * one can be asked for, and a suggested logo box fitted to the mark's own
 * pixels, for placing the logo when the server could not cut one. Colours
 * and everything else are measured on the server (lib/server/domains/design/extract).
 */

/** A part of an image, in fractions of its width and height. */
export interface ShotBox {
  x: number
  y: number
  w: number
  h: number
}

/** Pixels at least this opaque are read. */
const MIN_ALPHA = 128

const linear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** Relative luminance, 0 to 1. */
const luminance = (r: number, g: number, b: number) =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

/**
 * Whether a screenshot looks taken under a pop-up's dimming layer: its
 * brightest pixels all sit in one panel, and around it nothing comes near
 * white, as a dark veil leaves a page. A light page keeps its white
 * throughout; a dark site's white type runs all over it.
 */
export function looksDimmed(data: Uint8ClampedArray, width: number, height: number): boolean {
  const xs: number[] = []
  const ys: number[] = []
  let lightish = 0
  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    const l = luminance(data[p]!, data[p + 1]!, data[p + 2]!)
    if (l > 0.1) lightish++
    if (l > 0.7) {
      xs.push(i % width)
      ys.push(Math.floor(i / width))
    }
  }
  if (xs.length < width * height * 0.003) return false
  const at = (list: number[], share: number) =>
    list.sort((a, b) => a - b)[Math.floor((list.length - 1) * share)]!
  // The panel: where nearly all the bright pixels are.
  const box = { x0: at(xs, 0.01), x1: at(xs, 0.99), y0: at(ys, 0.01), y1: at(ys, 0.99) }
  const area = ((box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1)) / (width * height)
  if (area < 0.015 || area > 0.5) return false
  // A pop-up stands clear of the edges; a page's own white section runs to them.
  if (box.x0 < width * 0.01 || box.x1 > width * 0.99 || box.y1 > height * 0.985) return false
  // A page with little but black around the panel is a dark site, not a veiled one.
  return lightish / (width * height) > 0.3
}

/** A run of columns holding the mark's pixels, and how much of it the box held. */
interface Run {
  x0: number
  x1: number
  inside: number
}

/**
 * The suggested icon box fitted to the mark's own pixels: what stands out
 * from the page near the box is split into runs of columns, a run the box
 * holds at least half of is kept (a wordmark's last letter cut through the
 * middle comes back), one it only nicks is let go (the neighbouring name's
 * first letter), and the box fits what is kept with a little room around it.
 */
export function snapToMark(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  box: ShotBox
): ShotBox {
  const bx0 = Math.floor(box.x * width)
  const bx1 = Math.ceil((box.x + box.w) * width) - 1
  const by0 = Math.floor(box.y * height)
  const by1 = Math.ceil((box.y + box.h) * height) - 1
  const reach = Math.max(2, Math.round((bx1 - bx0 + 1) * 0.5))
  const rx0 = Math.max(0, bx0 - reach)
  const rx1 = Math.min(width - 1, bx1 + reach)
  const ry0 = Math.max(0, by0 - Math.round((by1 - by0 + 1) * 0.25))
  const ry1 = Math.min(height - 1, by1 + Math.round((by1 - by0 + 1) * 0.25))
  if (rx1 <= rx0 || ry1 <= ry0) return box
  // The page behind the mark: the most common colour on the searched area's edge.
  const counts = new Map<number, number>()
  const keyAt = (x: number, y: number) => {
    const p = (y * width + x) * 4
    return ((data[p]! >> 4) << 8) | ((data[p + 1]! >> 4) << 4) | (data[p + 2]! >> 4)
  }
  for (let x = rx0; x <= rx1; x++)
    for (const y of [ry0, ry1]) counts.set(keyAt(x, y), (counts.get(keyAt(x, y)) ?? 0) + 1)
  for (let y = ry0; y <= ry1; y++)
    for (const x of [rx0, rx1]) counts.set(keyAt(x, y), (counts.get(keyAt(x, y)) ?? 0) + 1)
  const ground = [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
  const [gr, gg, gb] = [
    (ground >> 8) * 16 + 8,
    ((ground >> 4) & 15) * 16 + 8,
    (ground & 15) * 16 + 8,
  ]
  const stands = (x: number, y: number) => {
    const p = (y * width + x) * 4
    return (
      data[p + 3]! >= MIN_ALPHA &&
      Math.abs(data[p]! - gr) + Math.abs(data[p + 1]! - gg) + Math.abs(data[p + 2]! - gb) > 60
    )
  }
  // Columns with the mark in them, over the box's own rows.
  const runs: Run[] = []
  let open: Run | null = null
  for (let x = rx0; x <= rx1 + 1; x++) {
    let on = false
    if (x <= rx1) for (let y = by0; y <= by1 && !on; y++) on = stands(x, y)
    if (on && !open) open = { x0: x, x1: x, inside: 0 }
    if (on && open) {
      open.x1 = x
      if (x >= bx0 && x <= bx1) open.inside++
    }
    if (!on && open) {
      runs.push(open)
      open = null
    }
  }
  const kept = runs.filter((run) => run.inside >= (run.x1 - run.x0 + 1) * 0.5)
  if (!kept.length) return box
  const x0 = Math.min(...kept.map((run) => run.x0))
  const x1 = Math.max(...kept.map((run) => run.x1))
  let y0 = ry1
  let y1 = ry0
  for (let y = ry0; y <= ry1; y++)
    for (let x = x0; x <= x1; x++)
      if (stands(x, y)) {
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
  if (y1 < y0) return box
  const pad = Math.max(1, Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 0.12))
  const left = Math.max(0, x0 - pad)
  const top = Math.max(0, y0 - pad)
  const right = Math.min(width, x1 + 1 + pad)
  const bottom = Math.min(height, y1 + 1 + pad)
  return { x: left / width, y: top / height, w: (right - left) / width, h: (bottom - top) / height }
}
