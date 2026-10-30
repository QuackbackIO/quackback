/**
 * The main colours of an image, for starting a design from a logo or a
 * screenshot. The browser reads the pixels, so the image never leaves it;
 * only the colours reach Quackback AI.
 */

/** Colours closer than this (in summed RGB distance) count as one. */
const MERGE_DISTANCE = 48
/** Pixels at least this opaque are counted. */
const MIN_ALPHA = 128

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`

/** The `count` most used colours in RGBA pixel data, most used first. */
export function paletteFromPixels(data: Uint8ClampedArray, count: number): string[] {
  // Bucket by the top five bits of each channel, keeping each bucket's mean.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    bucket.r += data[i]
    bucket.g += data[i + 1]
    bucket.b += data[i + 2]
    bucket.n++
    buckets.set(key, bucket)
  }
  const ranked = [...buckets.values()]
    .map(({ r, g, b, n }) => ({ r: r / n, g: g / n, b: b / n, n }))
    .sort((a, b) => b.n - a.n)
  const merged: typeof ranked = []
  for (const colour of ranked) {
    const near = merged.find(
      (kept) =>
        Math.abs(kept.r - colour.r) + Math.abs(kept.g - colour.g) + Math.abs(kept.b - colour.b) <
        MERGE_DISTANCE
    )
    if (near) near.n += colour.n
    else merged.push({ ...colour })
  }
  return merged
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map(({ r, g, b }) => hex(r, g, b))
}
