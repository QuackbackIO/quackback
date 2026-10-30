/**
 * The main colours of an image, for starting a design from a logo or a
 * screenshot. The browser reads the pixels, so the image never leaves it;
 * only the colours reach Quackback AI.
 */

/** Colours closer than this (in summed RGB distance) count as one. */
const MERGE_DISTANCE = 48
/** Pixels at least this opaque are counted. */
const MIN_ALPHA = 128

/** A colour with less than this share of the pixels is a speck, not a brand colour. */
const MIN_VIVID_SHARE = 0.01
/** Below this, a colour is too dull or dark to read as the brand colour. */
const MIN_VIVIDNESS = 0.25

/** Saturation weighted by brightness, 0 to 1: how much a colour reads as a colour. */
function vividness(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : ((max - min) / max) * (max / 255)
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`

/**
 * The `count` most used colours in RGBA pixel data, most used first. The most
 * vivid colour with a real share is always kept: on a screenshot, the page and
 * cards outnumber the brand colour that marks its buttons.
 */
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
  merged.sort((a, b) => b.n - a.n)
  const top = merged.slice(0, count)
  const total = merged.reduce((sum, colour) => sum + colour.n, 0)
  const vivid = merged
    .filter((colour) => colour.n / total >= MIN_VIVID_SHARE)
    .reduce<(typeof merged)[number] | null>(
      (best, colour) =>
        !best || vividness(colour.r, colour.g, colour.b) > vividness(best.r, best.g, best.b)
          ? colour
          : best,
      null
    )
  if (vivid && !top.includes(vivid) && vividness(vivid.r, vivid.g, vivid.b) >= MIN_VIVIDNESS) {
    if (top.length === count) top[count - 1] = vivid
    else top.push(vivid)
  }
  return top.map(({ r, g, b }) => hex(r, g, b))
}

/** The most vivid colour of a palette, when one reads as a brand colour. */
export function mostVivid(palette: string[]): string | null {
  let best: { colour: string; score: number } | null = null
  for (const colour of palette) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16))
    const score = vividness(r, g, b)
    if (score >= MIN_VIVIDNESS && (!best || score > best.score)) best = { colour, score }
  }
  return best?.colour ?? null
}
