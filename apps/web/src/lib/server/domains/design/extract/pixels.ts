/**
 * Pixel helpers shared by the geometry tools: a pixel read (clamped to the
 * image), medians, a box clamped to the image, and how far a colour has gone
 * from one colour toward another.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { RGB } from './color'
import type { Box } from './kinds'
import type { Image } from './png'

/** Image pixels per CSS pixel: 2 for a retina capture, 1024/1440 for a 1440px page sent at 1024. */
export interface GeometryOptions {
  scale?: number
}

export const px = (img: Image, x: number, y: number): RGB => {
  const xx = Math.min(img.width - 1, Math.max(0, Math.round(x)))
  const yy = Math.min(img.height - 1, Math.max(0, Math.round(y)))
  const o = (yy * img.width + xx) * 4
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
}

export const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export const medianColour = (cs: readonly RGB[]): RGB => [
  median(cs.map((c) => c[0])),
  median(cs.map((c) => c[1])),
  median(cs.map((c) => c[2])),
]

export const clampBox = (b: readonly number[], img: Image): Box => [
  Math.max(0, Math.round(b[0]!)),
  Math.max(0, Math.round(b[1]!)),
  Math.min(img.width, Math.round(b[2]!)),
  Math.min(img.height, Math.round(b[3]!)),
]

/** How far a colour has gone from `from` toward `to`: 0 at `from`, 1 at `to` (clamped). */
export function along(p: RGB, from: RGB, to: RGB): number {
  const v = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const vv = v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2
  if (vv < 1) return 0
  const t = ((p[0] - from[0]) * v[0]! + (p[1] - from[1]) * v[1]! + (p[2] - from[2]) * v[2]!) / vv
  return Math.min(1, Math.max(0, t))
}
