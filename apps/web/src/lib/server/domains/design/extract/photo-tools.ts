/**
 * Tools over a hero photo cut from a screenshot: cutting it, taking words
 * out of it, judging it (wide, sharp and clean enough to show), finding its
 * subject, and the veil that lets words read on it.
 *
 * Pure: no app imports, so the offline harness can load it.
 */
import type { Box } from './kinds'
import type { Image } from './png'
import { MIN_WIDTH, type PhotoPlace } from './hero-photo'

export interface PhotoQuality {
  ok: boolean
  /** The crop's width at CSS scale. */
  width: number
  /** Edge strength: the 90th percentile of the luminance Laplacian, 0 to 255. */
  sharp: number
  /** Grain: the median Laplacian, 0 to 255: a photo is smooth over most of it, noise is not. */
  grain: number
  why: string
}

/** A veil over a photo behind words: its tone, its strength in percent, and the worst colour left under the words. */
export interface PhotoShade {
  tone: 'dark' | 'light'
  strength: number
  under: string
}

/**
 * Below this edge strength a photo is a blurred placeholder (photos on the
 * goal and dev sites measure 2.5 to 57, dark soft-focus ones the least;
 * blurred as a loading placeholder is, under 1.8); above this grain it is
 * noise (photos measure 1 to 3; grain of 8 levels, about 20).
 */
export const MIN_SHARP = 2.2
export const MAX_GRAIN = 12

const lum = (d: Uint8Array, i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!

/** Block edge in CSS px. */
const BLOCK = 16

/** Part of an image, in whole pixels, clamped to it. */
export function cropImage(img: Image, box: readonly number[]): Image {
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

/**
 * Softens a box of an image in place: a wide box blur, several passes, so
 * words over a photo leave only the photo's colours; its edge feathered.
 */
export function soften(img: Image, box: readonly number[], radius: number): void {
  const x0 = Math.max(0, Math.round(box[0]!))
  const y0 = Math.max(0, Math.round(box[1]!))
  const x1 = Math.min(img.width, Math.round(box[2]!))
  const y1 = Math.min(img.height, Math.round(box[3]!))
  const w = x1 - x0
  const h = y1 - y0
  if (w < 2 || h < 2) return
  const r = Math.max(1, Math.round(radius))
  const orig = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4
      for (let c = 0; c < 3; c++) orig[(y * w + x) * 3 + c] = img.data[i + c]!
    }
  const buf = orig.slice()
  const tmp = new Float32Array(w * h * 3)
  for (let pass = 0; pass < 3; pass++) {
    // Across, then down: a running sum over 2r+1 pixels, clamped at the edges.
    for (let y = 0; y < h; y++)
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let k = -r; k <= r; k++) sum += buf[(y * w + Math.min(w - 1, Math.max(0, k))) * 3 + c]!
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 3 + c] = sum / (2 * r + 1)
          const out = Math.max(0, x - r)
          const inn = Math.min(w - 1, x + r + 1)
          sum += buf[(y * w + inn) * 3 + c]! - buf[(y * w + out) * 3 + c]!
        }
      }
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let k = -r; k <= r; k++) sum += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 3 + c]!
        for (let y = 0; y < h; y++) {
          buf[(y * w + x) * 3 + c] = sum / (2 * r + 1)
          const out = Math.max(0, y - r)
          const inn = Math.min(h - 1, y + r + 1)
          sum += tmp[(inn * w + x) * 3 + c]! - tmp[(out * w + x) * 3 + c]!
        }
      }
  }
  const feather = Math.max(1, Math.min(r, Math.floor(Math.min(w, h) / 4)))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y)
      const k = Math.min(1, (edge + 1) / feather)
      const i = ((y0 + y) * img.width + x0 + x) * 4
      for (let c = 0; c < 3; c++) {
        const t = (y * w + x) * 3 + c
        img.data[i + c] = Math.round(orig[t]! * (1 - k) + buf[t]! * k)
      }
    }
}

/**
 * Takes words (or a button) out of a photo in place: the box filled from the
 * photo around it, each pixel a blend of the colours at the box's edges on
 * its row and its column (nearer edges weigh more), the edges first smoothed
 * so no streaks run in, then softened, so only the photo's light remains.
 */
export function erase(img: Image, box: readonly number[]): void {
  const x0 = Math.max(1, Math.round(box[0]!))
  const y0 = Math.max(1, Math.round(box[1]!))
  const x1 = Math.min(img.width - 1, Math.round(box[2]!))
  const y1 = Math.min(img.height - 1, Math.round(box[3]!))
  const w = x1 - x0
  const h = y1 - y0
  if (w < 2 || h < 2) return
  const D = 6
  const at = (x: number, y: number, c: number) =>
    img.data[
      (Math.min(img.height - 1, Math.max(0, y)) * img.width +
        Math.min(img.width - 1, Math.max(0, x))) *
        4 +
        c
    ]!
  // Each edge: the mean of D pixels outward, then a running mean along it.
  const edge = (n: number, sample: (i: number, d: number, c: number) => number) => {
    const raw = new Float32Array(n * 3)
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let d = 1; d <= D; d++) sum += sample(i, d, c)
        raw[i * 3 + c] = sum / D
      }
    const out = new Float32Array(n * 3)
    const k = 12
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let m = 0
        for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
          sum += raw[j * 3 + c]!
          m++
        }
        out[i * 3 + c] = sum / m
      }
    return out
  }
  const left = edge(h, (i, d, c) => at(x0 - d, y0 + i, c))
  const right = edge(h, (i, d, c) => at(x1 - 1 + d, y0 + i, c))
  const top = edge(w, (i, d, c) => at(x0 + i, y0 - d, c))
  const bottom = edge(w, (i, d, c) => at(x0 + i, y1 - 1 + d, c))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      const wh = 1 / (Math.min(x, w - 1 - x) + 1)
      const wv = 1 / (Math.min(y, h - 1 - y) + 1)
      const i = ((y0 + y) * img.width + x0 + x) * 4
      for (let c = 0; c < 3; c++) {
        const across = left[y * 3 + c]! * (1 - u) + right[y * 3 + c]! * u
        const down = top[x * 3 + c]! * (1 - v) + bottom[x * 3 + c]! * v
        img.data[i + c] = Math.round((across * wh + down * wv) / (wh + wv))
      }
    }
  soften(
    img,
    [x0 - 4, y0 - 4, x1 + 4, y1 + 4],
    Math.max(2, Math.min(12, Math.round(Math.min(w, h) / 6)))
  )
}

/** The Laplacian's size on the luminance, 0 to 255, at every other pixel. */
function laplacian(img: Image, leaveOut: Box[]): number[] {
  const { width: W, height: H, data } = img
  const values: number[] = []
  for (let y = 1; y < H - 1; y += 2)
    for (let x = 1; x < W - 1; x += 2) {
      if (leaveOut.some((b) => x >= b[0] - 2 && x < b[2] + 2 && y >= b[1] - 2 && y < b[3] + 2))
        continue
      const i = (y * W + x) * 4
      const v =
        lum(data, i - 4) +
        lum(data, i + 4) +
        lum(data, i - W * 4) +
        lum(data, i + W * 4) -
        4 * lum(data, i)
      values.push(Math.abs(v))
    }
  return values
}

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
}

/**
 * Whether a crop, at CSS scale, is good enough to show: wide enough for its
 * place, sharp (not a blurred placeholder), and not grainy. Softened words
 * are left out of the measure.
 */
export function photoQuality(
  cssCrop: Image,
  place: PhotoPlace,
  leaveOut: Box[] = []
): PhotoQuality {
  const values = laplacian(cssCrop, leaveOut)
  const sharp = percentile(values, 0.9)
  const grain = percentile(values, 0.5)
  const width = cssCrop.width
  const why =
    width < MIN_WIDTH[place]
      ? `the photo is ${width}px wide, too small to show`
      : sharp < MIN_SHARP
        ? 'the photo is blurred in the screenshot'
        : grain > MAX_GRAIN
          ? 'the photo is grainy in the screenshot'
          : 'the photo is sharp and large enough'
  return {
    ok: width >= MIN_WIDTH[place] && sharp >= MIN_SHARP && grain <= MAX_GRAIN,
    width,
    sharp,
    grain,
    why,
  }
}

/**
 * Where the photo's subject is, in percent across and down the crop: the
 * window (a quarter of the width, a third of the height) holding the most
 * detail, leaving out the boxes given (softened words), as a person, a face
 * or a product carries the most detail; its detail's centre. Flat paper
 * with type on it (a badge stuck on the photo) is not counted.
 */
export function photoFocus(cssCrop: Image, leaveOut: Box[] = []): { x: number; y: number } {
  const { width: W, height: H, data } = cssCrop
  const cols = Math.floor(W / BLOCK)
  const rows = Math.floor(H / BLOCK)
  if (cols < 1 || rows < 1) return { x: 50, y: 50 }
  const energy = new Float64Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = c * BLOCK + BLOCK / 2
      const cy = r * BLOCK + BLOCK / 2
      if (leaveOut.some((b) => cx >= b[0] && cx < b[2] && cy >= b[1] && cy < b[3])) continue
      let e = 0
      const bins = new Map<number, number>()
      for (let y = r * BLOCK; y < (r + 1) * BLOCK - 1; y++)
        for (let x = c * BLOCK; x < (c + 1) * BLOCK - 1; x++) {
          const i = (y * W + x) * 4
          e +=
            Math.abs(lum(data, i) - lum(data, i + 4)) +
            Math.abs(lum(data, i) - lum(data, i + W * 4))
          const k = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3)
          bins.set(k, (bins.get(k) ?? 0) + 1)
        }
      // A sticker or a badge on the photo (flat paper with type) is not its subject.
      const flat = Math.max(...bins.values()) / ((BLOCK - 1) * (BLOCK - 1))
      energy[r * cols + c] = flat > 0.4 ? 0 : e
    }
  const ww = Math.max(1, Math.round(cols / 4))
  const wh = Math.max(1, Math.round(rows / 3))
  let best = { c: 0, r: 0, e: -1 }
  for (let r = 0; r + wh <= rows; r++)
    for (let c = 0; c + ww <= cols; c++) {
      let e = 0
      for (let j = r; j < r + wh; j++) for (let i = c; i < c + ww; i++) e += energy[j * cols + i]!
      if (e > best.e) best = { c, r, e }
    }
  let sum = 0
  let sx = 0
  let sy = 0
  for (let j = best.r; j < best.r + wh; j++)
    for (let i = best.c; i < best.c + ww; i++) {
      const e = energy[j * cols + i]!
      sum += e
      sx += (i + 0.5) * BLOCK * e
      sy += (j + 0.5) * BLOCK * e
    }
  if (!sum) return { x: 50, y: 50 }
  return { x: Math.round((sx / sum / W) * 100), y: Math.round((sy / sum / H) * 100) }
}

/** Relative luminance of an sRGB colour, 0 to 1. */
function luminance(rgb: readonly number[]): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb[0]!) + 0.7152 * lin(rgb[1]!) + 0.0722 * lin(rgb[2]!)
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const hexOf = (rgb: readonly number[]) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`

/** Lightest and darkest veils tried, percent. */
const SHADE_MIN = 20
const SHADE_MAX = 85
/** The share of the photo the words must read on: all but its brightest (or darkest) tenth. */
const SHADE_COVER = 0.9

/**
 * The veil over a photo behind the portal's words: black under white words
 * or white under near-black ones, whichever the photo needs less of, as
 * light as lets the words read at 4.5:1 over nine tenths of the photo
 * (they may sit anywhere on it); and the worst colour left under them.
 */
export function photoShade(cssCrop: Image): PhotoShade {
  const { data } = cssCrop
  const px: Array<[number, number, number]> = []
  for (let i = 0; i < data.length; i += 4 * 7) px.push([data[i]!, data[i + 1]!, data[i + 2]!])
  const byLum = px.map((p) => ({ p, l: luminance(p) })).sort((a, b) => a.l - b.l)
  const brightest = byLum[Math.min(byLum.length - 1, Math.floor(SHADE_COVER * byLum.length))]!.p
  const darkest = byLum[Math.floor((1 - SHADE_COVER) * byLum.length)]!.p
  const veil = (p: readonly number[], tone: 'dark' | 'light', s: number) =>
    p.map((v) => (tone === 'dark' ? v * (1 - s / 100) : v + (255 - v) * (s / 100)))
  const fit = (tone: 'dark' | 'light') => {
    const worst = tone === 'dark' ? brightest : darkest
    const ink = tone === 'dark' ? 1 : luminance([17, 17, 17])
    for (let s = SHADE_MIN; s <= SHADE_MAX; s += 5) {
      const under = veil(worst, tone, s)
      if (ratio(luminance(under), ink) >= 4.5) return { tone, strength: s, under: hexOf(under) }
    }
    return { tone, strength: SHADE_MAX, under: hexOf(veil(worst, tone, SHADE_MAX)) }
  }
  const dark = fit('dark')
  const light = fit('light')
  return light.strength < dark.strength ? light : dark
}
