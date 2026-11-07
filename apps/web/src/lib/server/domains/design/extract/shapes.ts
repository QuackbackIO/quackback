/**
 * Filled shapes that hold a label (buttons, chips, badges), found anywhere
 * in a region by flood fill: one colour, a rectangle or pill of the given
 * size with straight top and bottom edges, contrasting pixels in its middle,
 * and a different colour around it.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { hex, type RGB } from './color'
import { clampBox, dist3, labDist, labImage, type Swatch } from './colours'
import type { Box } from './kinds'
import type { Image } from './png'

export interface SolidShape {
  box: Box
  fill: Swatch
  /** The colour of what sits in its holes (its label), when it has one. */
  ink: Swatch | null
  /** Pixels of the fill over the box's area. */
  solidity: number
}

export interface ShapeOptions {
  /** Height range in pixels. */
  minHeight?: number
  maxHeight?: number
  /** Width over height range. */
  minAspect?: number
  maxAspect?: number
  /** OKLab distance within which a neighbour joins a shape. */
  tolerance?: number
}

/**
 * Filled shapes that hold a label: connected regions of one colour, shaped
 * like a button, chip or badge (a rectangle or pill of the given size), with
 * holes in their middle (the label) and a different colour around them.
 */
export function solidShapes(
  img: Image,
  box?: readonly number[] | null,
  opts: ShapeOptions = {}
): SolidShape[] {
  const {
    minHeight = 14,
    maxHeight = 72,
    minAspect = 0.9,
    maxAspect = 14,
    tolerance = 0.035,
  } = opts
  const b = clampBox(box ?? [0, 0, img.width, img.height], img)
  const L = labImage(img)
  const W = img.width
  const bw = b[2] - b[0]
  const bh = b[3] - b[1]
  if (bw < 4 || bh < 4) return []
  const seen = new Uint8Array(bw * bh)
  const out: SolidShape[] = []
  const stack: number[] = []
  for (let sy = 0; sy < bh; sy += 2) {
    for (let sx = 0; sx < bw; sx += 2) {
      if (seen[sy * bw + sx]) continue
      const seed = (b[1] + sy) * W + b[0] + sx
      let n = 0
      let x0 = sx
      let x1 = sx
      let y0 = sy
      let y1 = sy
      let tooBig = false
      const c = [0, 0, 0]
      stack.length = 0
      stack.push(sy * bw + sx)
      seen[sy * bw + sx] = 1
      while (stack.length) {
        const j = stack.pop()!
        const x = j % bw
        const y = (j - x) / bw
        const i = (b[1] + y) * W + b[0] + x
        n++
        c[0] += img.data[i * 4]!
        c[1] += img.data[i * 4 + 1]!
        c[2] += img.data[i * 4 + 2]!
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        if (y1 - y0 > maxHeight * 3) tooBig = true
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
          const nj = ny * bw + nx
          if (seen[nj]) continue
          const ni = (b[1] + ny) * W + b[0] + nx
          if (dist3(L, ni * 3, L, seed * 3) > tolerance) continue
          seen[nj] = 1
          stack.push(nj)
        }
      }
      if (tooBig) continue
      const h = y1 - y0 + 1
      const w = x1 - x0 + 1
      if (h < minHeight || h > maxHeight || w < h * minAspect || w > h * maxAspect) continue
      const solidity = n / (w * h)
      if (solidity < 0.55 || solidity > 0.985) continue
      // Straight top and bottom edges: rows just inside them are filled across the middle.
      const straight = [0.12, 0.88].every((fy) => {
        const y = b[1] + y0 + Math.round((h - 1) * fy)
        let on = 0
        let all = 0
        for (let x = b[0] + x0 + Math.round(w * 0.2); x <= b[0] + x1 - Math.round(w * 0.2); x++) {
          all++
          if (dist3(L, (y * W + x) * 3, L, seed * 3) <= tolerance) on++
        }
        return all > 0 && on >= 0.9 * all
      })
      if (!straight) continue
      // The label: unfilled pixels in the middle band of the shape.
      const ix0 = b[0] + x0 + Math.round(Math.min(w * 0.25, h * 0.5))
      const ix1 = b[0] + x1 - Math.round(Math.min(w * 0.25, h * 0.5))
      const iy0 = b[1] + y0 + Math.round(h * 0.25)
      const iy1 = b[1] + y1 - Math.round(h * 0.25)
      let holes = 0
      let inner = 0
      const ink: number[][] = []
      for (let y = iy0; y <= iy1; y++) {
        for (let x = ix0; x <= ix1; x++) {
          inner++
          const i = y * W + x
          const d = dist3(L, i * 3, L, seed * 3)
          if (d > tolerance) {
            holes++
            if (d > 0.12) ink.push([L[i * 3]!, L[i * 3 + 1]!, L[i * 3 + 2]!, i])
          }
        }
      }
      if (!inner || holes / inner < 0.03 || holes / inner > 0.75) continue
      // Something else around it: a ring just outside the box differs from the fill.
      let ring = 0
      let ringDiff = 0
      const rx0 = Math.max(0, b[0] + x0 - 2)
      const rx1 = Math.min(W - 1, b[0] + x1 + 2)
      const ry0 = Math.max(0, b[1] + y0 - 2)
      const ry1 = Math.min(img.height - 1, b[1] + y1 + 2)
      for (let x = rx0; x <= rx1; x += 2) {
        for (const y of [ry0, ry1]) {
          ring++
          if (dist3(L, (y * W + x) * 3, L, seed * 3) > tolerance) ringDiff++
        }
      }
      if (!ring || ringDiff / ring < 0.6) continue
      const rgb: RGB = [c[0]! / n, c[1]! / n, c[2]! / n]
      const fill: Swatch = {
        hex: hex(rgb),
        rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])],
        lab: [L[seed * 3]!, L[seed * 3 + 1]!, L[seed * 3 + 2]!],
        share: 1,
      }
      let inkSw: Swatch | null = null
      // A label: enough clearly contrasting pixels in the middle.
      if (ink.length < Math.max(3, inner * 0.02)) continue
      if (ink.length >= 3) {
        // The most contrasting colour of the label's pixels, averaged near it.
        ink.sort((p, q) => labDist(q, fill.lab) - labDist(p, fill.lab))
        const top = ink.slice(0, Math.max(3, Math.ceil(ink.length * 0.3)))
        const s = [0, 0, 0, 0, 0, 0]
        for (const p of top) {
          const i = p[3]!
          s[0] += p[0]!
          s[1] += p[1]!
          s[2] += p[2]!
          s[3] += img.data[i * 4]!
          s[4] += img.data[i * 4 + 1]!
          s[5] += img.data[i * 4 + 2]!
        }
        const k = top.length
        const irgb: RGB = [s[3]! / k, s[4]! / k, s[5]! / k]
        inkSw = {
          hex: hex(irgb),
          rgb: [Math.round(irgb[0]), Math.round(irgb[1]), Math.round(irgb[2])],
          lab: [s[0]! / k, s[1]! / k, s[2]! / k],
          share: holes / inner,
        }
      }
      out.push({
        box: [b[0] + x0, b[1] + y0, b[0] + x1 + 1, b[1] + y1 + 1],
        fill,
        ink: inkSw,
        solidity,
      })
    }
  }
  return out
}
