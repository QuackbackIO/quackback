/**
 * Crops a decision family looks at, rather than whole screenshots: the hero
 * with the header above it, at most 768px wide, as PNG.
 */
import { downscale, encodePng, type Image } from '../extract/png'
import type { Shot } from './brand-measure'

/** Widest crop sent. */
const MAX_WIDTH = 768

/** Part of an image, in whole pixels, clamped to it. */
export function crop(img: Image, box: readonly number[]): Image {
  const x0 = Math.max(0, Math.round(box[0]!))
  const y0 = Math.max(0, Math.round(box[1]!))
  const x1 = Math.min(img.width, Math.round(box[2]!))
  const y1 = Math.min(img.height, Math.round(box[3]!))
  const w = Math.max(1, x1 - x0)
  const h = Math.max(1, y1 - y0)
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    data.set(
      img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4),
      y * w * 4
    )
  return { width: w, height: h, data }
}

/** The hero and the header above it, or the top of the page without a hero box; null on failure. */
export function heroCrop(shot: Shot): Uint8Array | null {
  try {
    const { img } = shot
    const hero = shot.found.snapped.hero
    const bottom = hero ? hero[3] : Math.min(img.height, Math.round(img.width * 0.6))
    const part = crop(img, [0, 0, img.width, Math.max(bottom, Math.min(img.height, 200))])
    return encodePng(downscale(part, Math.ceil(part.width / MAX_WIDTH)))
  } catch {
    return null
  }
}
