/**
 * A logo cutout drawn larger with crisp edges, so a logo cut from a 1x
 * screenshot stays sharp in a header on a phone's screen.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { Image } from './png'

/** Under this stroke width, in px at the screenshot's scale, a cut is too fine to redraw faithfully. */
export const FINEST_STROKE = 2.5

/**
 * The ink's mean stroke width in px: twice its solid area over its outline's
 * length (a stroke of width w and length l has area wl and outline 2l).
 */
export function strokeWidth(img: Image): number {
  const { width: w, height: h, data } = img
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! >= 128
  let area = 0
  let edge = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue
      area++
      if (!solid(x + 1, y) || !solid(x - 1, y) || !solid(x, y + 1) || !solid(x, y - 1)) edge++
    }
  return edge ? (2 * area) / edge : 0
}

/** A flat cut is drawn at least this many px tall (three times the header's 32 px logo). */
export const SHARP_PX = 96
export const MAX_SHARP = 4
/** Where a cut's alpha peaks under this nearby, it is a faint hairline: kept soft, never cut away. */
const FAINT = 0.75 * 255

/** Catmull-Rom weights for a sample at fraction t past the second of four taps. */
function cubic(t: number): [number, number, number, number] {
  const t2 = t * t
  const t3 = t2 * t
  return [
    0.5 * (-t3 + 2 * t2 - t),
    0.5 * (3 * t3 - 5 * t2 + 2),
    0.5 * (-3 * t3 + 4 * t2 + t),
    0.5 * (t3 - t2),
  ]
}

/**
 * The cutout `k` times larger with its edges crisp at the new size, as a
 * traced logo would be: colour and alpha interpolated smoothly
 * (premultiplied, so the clear background lends no colour), then each
 * edge's alpha ramp narrowed to about a pixel. Where the ink is faint (a
 * hairline under half cover), the alpha stays as interpolated.
 */
export function sharpened(img: Image, k: number): Image {
  const { width: w, height: h, data: src } = img
  const W = w * k
  const H = h * k
  const out = new Uint8Array(W * H * 4)
  const tap = (x: number, y: number, ch: number) => {
    const cx = Math.min(w - 1, Math.max(0, x))
    const cy = Math.min(h - 1, Math.max(0, y))
    const o = (cy * w + cx) * 4
    const a = src[o + 3]!
    return ch === 3 ? a : (src[o + ch]! * a) / 255
  }
  for (let Y = 0; Y < H; Y++) {
    const v = (Y + 0.5) / k - 0.5
    const y0 = Math.floor(v)
    const wy = cubic(v - y0)
    for (let X = 0; X < W; X++) {
      const u = (X + 0.5) / k - 0.5
      const x0 = Math.floor(u)
      const wx = cubic(u - x0)
      const acc = [0, 0, 0, 0]
      let peak = 0
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) {
          const f = wx[i]! * wy[j]!
          for (let ch = 0; ch < 4; ch++) acc[ch]! += f * tap(x0 - 1 + i, y0 - 1 + j, ch)
          if (i >= 1 && i <= 2 && j >= 1 && j <= 2)
            peak = Math.max(peak, tap(x0 - 1 + i, y0 - 1 + j, 3))
        }
      const a = Math.min(255, Math.max(0, acc[3]!))
      const o = (Y * W + X) * 4
      if (a <= 0) continue
      for (let ch = 0; ch < 3; ch++)
        out[o + ch] = Math.round(Math.min(255, Math.max(0, (acc[ch]! * 255) / a)))
      const crisp = peak < FAINT ? a : Math.min(255, Math.max(0, (a - 127.5) * k + 127.5))
      out[o + 3] = Math.round(crisp)
    }
  }
  return { width: W, height: H, data: out }
}
