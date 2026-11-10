/**
 * Photos in colour evidence: a hero the finder saw a photo behind (its smooth,
 * blurred parts too), a header laid over it, and the colours around a logo
 * (a photo behind it), so none of them is taken for a brand colour.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { oklab, type RGB } from './color'
import { clampBox, labDist } from './colours'
import type { Box } from './kinds'
import type { Image } from './png'
import { regionPalette, surfaceMap } from './surfaces'

/** A hero this much photo or gradient, where the finder saw a photo, is all photo. */
export const PHOTO_SMOOTH_SHARE = 0.25

/**
 * A header laid over the photo hero (a transparent header): no flat colour of
 * its own, or its main colour one the photo shows just below it.
 */
export function headerOnPhoto(img: Image, header: Box, hero: Box, size: number): boolean {
  const pal = regionPalette(img, header, size)
  if (pal.isPhoto) return true
  const top = pal.colours[0]
  if (!top || top.share < 0.5) return true
  const strip = clampBox([hero[0], hero[1], hero[2], hero[1] + Math.max(size * 3, 24)], img)
  if (strip[3] - strip[1] < size) return false
  const below = surfaceMap(img, strip, size)
  let near = 0
  for (let t = 0; t < below.kind.length; t++)
    if (labDist([below.lab[t * 3]!, below.lab[t * 3 + 1]!, below.lab[t * 3 + 2]!], top.lab) < 0.05)
      near++
  // A photo's colour shows in places under it; the page's own header colour is not in the
  // photo, and a flat band of it all along is the page's, not a photo's.
  return near > 0 && near < 0.9 * below.kind.length
}

/** The colours of the pixels just around a box (OKLab), sampled every other pixel. */
export function ringColours(img: Image, b: Box): RGB[] {
  const m = Math.max(2, Math.round((b[3] - b[1]) * 0.25))
  const r = clampBox([b[0] - m, b[1] - m, b[2] + m, b[3] + m], img)
  const out: RGB[] = []
  const at = (x: number, y: number) => {
    const o = (y * img.width + x) * 4
    out.push(oklab([img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]))
  }
  for (let x = r[0]; x < r[2]; x += 2) {
    at(x, r[1])
    at(x, r[3] - 1)
  }
  for (let y = r[1]; y < r[3]; y += 2) {
    at(r[0], y)
    at(r[2] - 1, y)
  }
  return out
}

/** A colour much of the ring around the logo shows: what the logo sits on, not its ink. */
export const aroundShare = (ring: RGB[], lab: readonly number[]) =>
  ring.length > 0 && ring.filter((c) => labDist(c, lab) < 0.06).length >= 0.1 * ring.length
