/**
 * The main colours of an image, for starting a design from a logo or a
 * screenshot. The browser reads the pixels, so the image never leaves it;
 * only the colours reach Quackback AI.
 */

/** Colours closer than this (in summed RGB distance) count as one. */
const MERGE_DISTANCE = 48
/** Pixels at least this opaque are counted. */
const MIN_ALPHA = 128

/** Below this, a colour is too grey or too near black to read as the brand colour. */
const BRAND_COLOURFULNESS = 0.3
/** A pixel at least this colourful can belong to the brand colour. */
const BRAND_PIXEL = 0.4
/** Fewer vivid pixels of one hue than this are a speck, not a brand colour. */
const MIN_VIVID_PIXELS = 4
/** Hue groups of 30 degrees each. */
const HUE_GROUPS = 12

/** A colour's hue group, for gathering the shades anti-aliasing splits a colour into. */
function hueGroup(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  const hue =
    max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return Math.floor((hue * 60) / (360 / HUE_GROUPS)) % HUE_GROUPS
}

/** Saturation weighted by brightness, 0 to 1: how much a colour reads as a colour. */
function vividness(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : ((max - min) / max) * (max / 255)
}

/**
 * How much a colour reads as a colour, 0 to 1: its saturation, fading only
 * toward black. A deep brand colour, a forest green or a navy, counts as much
 * as a bright one; a grey or near-black does not.
 */
function colourfulness(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  if (max < 40) return 0
  return ((max - Math.min(r, g, b)) / max) * Math.min(1, max / 100)
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`

/**
 * The `count` most used colours in RGBA pixel data, most used first. The brand
 * colour is always kept: on a screenshot the page and cards outnumber it, and
 * anti-aliasing splits a small button's colour into shades too rare to rank.
 */
export function paletteFromPixels(data: Uint8ClampedArray, count: number): string[] {
  // Bucket by the top five bits of each channel, keeping each bucket's mean.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  const hues = Array.from({ length: HUE_GROUPS }, () => ({ r: 0, g: 0, b: 0, n: 0 }))
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue
    if (colourfulness(data[i], data[i + 1], data[i + 2]) >= BRAND_PIXEL) {
      const group = hues[hueGroup(data[i], data[i + 1], data[i + 2])]
      group.r += data[i]
      group.g += data[i + 1]
      group.b += data[i + 2]
      group.n++
    }
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
  // The brand colour, first: the largest group of colourful pixels of one hue, as their mean.
  const group = hues.reduce((best, next) => (next.n > best.n ? next : best))
  if (group.n >= MIN_VIVID_PIXELS) {
    const brand = { r: group.r / group.n, g: group.g / group.n, b: group.b / group.n, n: group.n }
    const near = (kept: typeof brand) =>
      Math.abs(kept.r - brand.r) + Math.abs(kept.g - brand.g) + Math.abs(kept.b - brand.b) <
      MERGE_DISTANCE
    const rest = top.filter((kept) => !near(kept)).slice(0, count - 1)
    return [brand, ...rest].map(({ r, g, b }) => hex(r, g, b))
  }
  return top.map(({ r, g, b }) => hex(r, g, b))
}

/** How much a hex colour reads as a colour rather than a neutral, 0 to 1. */
export function colourVividness(colour: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16))
  return vividness(r, g, b)
}

/** Whether a hex colour can be a brand colour: a colour, not a grey, a white or a near-black. */
export function isBrandColour(colour: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16))
  return colourfulness(r!, g!, b!) >= BRAND_COLOURFULNESS
}

/** A palette's brand colour: the first that can be one, as paletteFromPixels puts it first. */
export function brandColour(palette: string[]): string | null {
  return palette.find(isBrandColour) ?? null
}
