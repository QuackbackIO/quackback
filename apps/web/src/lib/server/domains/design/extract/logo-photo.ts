/**
 * A logo on a photo (a white wordmark over a hero picture): its one ink,
 * told from the photo's colours around it, with soft alpha at its edges.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { okDist, type RGB } from './color'
import type { Box } from './kinds'
import type { Image } from './png'

/** OKLab distance from the background where ink starts. */
export const LO = 0.035
/** A pixel this far from every photo colour is not the photo. */
const HI = 0.11

/** Ink on a photo: at least this far (OKLab) from every colour of the photo around it. */
const PHOTO_REACH = 0.2

/**
 * The logo's ink where the header is a photo (a white wordmark on a hero
 * picture): the colour most of the box holds and the frame around it lacks,
 * and its alpha per pixel (1 at the ink, 0 as far from it as the nearest
 * photo colour, so blended edges stay soft). Null where no single ink
 * stands apart: a logo of several colours, or a box of more photo.
 */
export function photoInk(
  img: Image,
  b: Box,
  rings: Box[]
): { ink: RGB; alpha: (p: RGB) => number } | null {
  const px = (x: number, y: number): RGB => {
    const o = (y * img.width + x) * 4
    return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
  }
  const bin = (c: RGB) => ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4)
  const binned = (cs: RGB[]) => {
    const m = new Map<number, { n: number; s: [number, number, number] }>()
    for (const c of cs) {
      const e = m.get(bin(c)) ?? { n: 0, s: [0, 0, 0] }
      e.n++
      for (let k = 0; k < 3; k++) e.s[k]! += c[k]!
      m.set(bin(c), e)
    }
    return [...m.values()]
      .sort((p, q) => q.n - p.n)
      .map((e) => ({ n: e.n, c: e.s.map((v) => v / e.n) as RGB }))
  }
  const ringPx: RGB[] = []
  for (const r of rings) {
    for (let x = r[0]; x < r[2]; x++) ringPx.push(px(x, r[1]), px(x, r[3] - 1))
    for (let y = r[1] + 1; y < r[3] - 1; y++) ringPx.push(px(r[0], y), px(r[2] - 1, y))
  }
  const boxPx: RGB[] = []
  for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) boxPx.push(px(x, y))
  if (!ringPx.length || boxPx.length < 16) return null
  const near = (cs: RGB[], c: RGB, d: number) => cs.filter((p) => okDist(p, c) < d).length
  // The ink: the box's fullest colour that the frame hardly has (a box cutting the mark
  // leaves a few of its pixels on the frame).
  const seed = binned(boxPx).find(
    (e) => e.n >= 0.03 * boxPx.length && near(ringPx, e.c, 0.1) < 0.1 * ringPx.length
  )
  if (!seed) return null
  const inked = boxPx.filter((p) => okDist(p, seed.c) < 0.1)
  const med = (k: number) => inked.map((p) => p[k]!).sort((x, y) => x - y)[inked.length >> 1]!
  const ink: RGB = [med(0), med(1), med(2)]
  // The photo's colours: the frame's, less the mark's own pixels on it and the blends at its
  // edges (the nearest few).
  const far = ringPx
    .map((p) => okDist(p, ink))
    .filter((d) => d > 0.15)
    .sort((x, y) => x - y)
  if (far.length < 0.5 * ringPx.length) return null
  const reach = far[Math.floor(far.length * 0.05)]!
  if (reach < PHOTO_REACH) return null
  const photoCols = binned(ringPx)
    .map((e) => e.c)
    .filter((c) => okDist(c, ink) >= reach)
  const alpha = (p: RGB) => {
    const d = okDist(p, ink)
    return d <= LO ? 1 : d >= reach ? 0 : (reach - d) / (reach - LO)
  }
  // One ink standing apart: a fair share of the box, little of the frame, and the rest of
  // the box near the photo's colours (not a second ink).
  const inkShare = boxPx.filter((p) => alpha(p) >= 0.5).length / boxPx.length
  const ringShare = ringPx.filter((p) => alpha(p) >= 0.5).length / ringPx.length
  const other =
    boxPx.filter((p) => alpha(p) < 0.5 && Math.min(...photoCols.map((c) => okDist(p, c))) > HI)
      .length / boxPx.length
  if (inkShare < 0.04 || inkShare > 0.75 || ringShare > 0.15 || other > 0.15) return null
  return { ink, alpha }
}
