/**
 * Synthetic images with known answers for the type and geometry tools:
 * anti-aliased shapes (each pixel covered by its share of a 4x4 sample grid)
 * and block letters whose capital height, x-height, stem and gaps are exact.
 */
import type { Image } from '../png'

export type Fill = [number, number, number]

export function canvas(width: number, height: number, bg: Fill): Image {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4)
  return { width, height, data }
}

/** Paint a shape given by `inside(x, y)` (continuous coordinates), anti-aliased. */
export function paint(
  img: Image,
  bounds: [number, number, number, number],
  inside: (x: number, y: number) => boolean,
  c: Fill
) {
  const [x0, y0, x1, y1] = bounds.map(Math.floor) as [number, number, number, number]
  for (let y = Math.max(0, y0 - 1); y < Math.min(img.height, y1 + 2); y++) {
    for (let x = Math.max(0, x0 - 1); x < Math.min(img.width, x1 + 2); x++) {
      let n = 0
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++
      if (!n) continue
      const a = n / 16
      const o = (y * img.width + x) * 4
      for (let k = 0; k < 3; k++)
        img.data[o + k] = Math.round(img.data[o + k]! * (1 - a) + c[k]! * a)
    }
  }
}

export function rect(img: Image, [x0, y0, x1, y1]: [number, number, number, number], c: Fill) {
  paint(img, [x0, y0, x1, y1], (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1, c)
}

/** A rectangle with circular corners of radius r. */
export function roundRect(
  img: Image,
  [x0, y0, x1, y1]: [number, number, number, number],
  r: number,
  c: Fill
) {
  paint(
    img,
    [x0, y0, x1, y1],
    (x, y) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return false
      const cx = Math.min(Math.max(x, x0 + r), x1 - r)
      const cy = Math.min(Math.max(y, y0 + r), y1 - r)
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    },
    c
  )
}

/** A rounded rectangle's outline only, `width` px thick. */
export function roundOutline(
  img: Image,
  [x0, y0, x1, y1]: [number, number, number, number],
  r: number,
  width: number,
  c: Fill
) {
  const inR = (x: number, y: number, b: number[], rr: number) => {
    if (x < b[0]! || x >= b[2]! || y < b[1]! || y >= b[3]!) return false
    const cx = Math.min(Math.max(x, b[0]! + rr), b[2]! - rr)
    const cy = Math.min(Math.max(y, b[1]! + rr), b[3]! - rr)
    return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr
  }
  const inner = [x0 + width, y0 + width, x1 - width, y1 - width]
  paint(
    img,
    [x0, y0, x1, y1],
    (x, y) => inR(x, y, [x0, y0, x1, y1], r) && !inR(x, y, inner, Math.max(0, r - width)),
    c
  )
}

export interface Letters {
  /** Left edge and baseline, in px. */
  x: number
  baseline: number
  cap: number
  xHeight: number
  stem: number
  /** Gap between letters, px. */
  gap: number
  /** Gap between words, px. */
  space?: number
}

/**
 * Block letters: 'H' is capital height (two stems and a bar), 'n' x-height
 * (two stems and a top bar), 'l' a capital-height stem, ' ' a word space.
 * Returns the right edge.
 */
export function letters(img: Image, text: string, l: Letters, c: Fill): number {
  let x = l.x
  const b = l.baseline
  const s = l.stem
  for (const ch of text) {
    if (ch === ' ') {
      x += (l.space ?? l.cap * 0.35) - l.gap
      continue
    }
    if (ch === 'H') {
      const w = l.cap * 0.7
      rect(img, [x, b - l.cap, x + s, b], c)
      rect(img, [x + w - s, b - l.cap, x + w, b], c)
      rect(img, [x, b - l.cap / 2 - s * 0.4, x + w, b - l.cap / 2 + s * 0.4], c)
      x += w + l.gap
    } else if (ch === 'n') {
      const w = l.xHeight * 0.95
      rect(img, [x, b - l.xHeight, x + s, b], c)
      rect(img, [x + w - s, b - l.xHeight, x + w, b], c)
      rect(img, [x, b - l.xHeight, x + w, b - l.xHeight + s * 0.8], c)
      x += w + l.gap
    } else if (ch === 'l') {
      rect(img, [x, b - l.cap, x + s, b], c)
      x += s + l.gap
    }
  }
  return x - l.gap
}

/** One layer of a CSS box-shadow: offsets, blur and spread in px, and its black's opacity. */
export interface ShadowLayer {
  y: number
  blur: number
  spread?: number
  alpha: number
}

/** The normal CDF, for a blurred edge (CSS blurs with a Gaussian of sigma = blur / 2). */
function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

/** Draw a black box-shadow under a box, as a browser does, over what is there. */
export function boxShadow(
  img: Image,
  [x0, y0, x1, y1]: [number, number, number, number],
  layers: ShadowLayer[]
) {
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      let keep = 1
      for (const l of layers) {
        const s = Math.max(0.01, l.blur / 2)
        const sp = l.spread ?? 0
        const cov = (lo: number, hi: number, v: number) => phi((v - lo) / s) - phi((v - hi) / s)
        const a =
          l.alpha * cov(x0 - sp, x1 + sp, x + 0.5) * cov(y0 + l.y - sp, y1 + l.y + sp, y + 0.5)
        keep *= 1 - a
      }
      const o = (y * img.width + x) * 4
      for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(img.data[o + k]! * keep)
    }
}
