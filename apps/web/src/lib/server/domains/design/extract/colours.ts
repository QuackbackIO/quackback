/**
 * Colour measuring tools over decoded pixels, each inside a box the element
 * finder drew:
 *
 * - `fillAndInk`: an element's fill and its text colour. Pixels are
 *   clustered in OKLab after anti-aliased edge pixels (those lying between
 *   their two opposite neighbours) are dropped; the largest cluster is the
 *   fill (for text, the cluster that holds the box's frame), the most
 *   contrasting minority cluster is the ink, read from its stroke cores.
 * - `boxColours`: every ink colour over a box's background, with shares
 *   (a logo's colours).
 *
 * Regions, photos and gradients are in surfaces.ts; filled shapes with a
 * label (buttons, badges) in shapes.ts.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { hex, type RGB } from './color'
import type { Box } from './kinds'
import type { Image } from './png'

/** A measured colour and the share of its region it covers (0 to 1). */
export interface Swatch {
  hex: string
  rgb: RGB
  /** OKLab. */
  lab: RGB
  share: number
}

// ---------- OKLab per pixel ----------

const LIN = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function toLab(r: number, g: number, b: number, out: Float32Array, o: number) {
  const R = LIN[r]!
  const G = LIN[g]!
  const B = LIN[b]!
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
}

const labCache = new WeakMap<Uint8Array, Float32Array>()

/** OKLab of every pixel, computed once per image. */
export function labImage(img: Image): Float32Array {
  const hit = labCache.get(img.data)
  if (hit) return hit
  const n = img.width * img.height
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++)
    toLab(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!, out, i * 3)
  labCache.set(img.data, out)
  return out
}

export const dist3 = (p: ArrayLike<number>, i: number, q: ArrayLike<number>, j: number) =>
  Math.hypot(p[i]! - q[j]!, p[i + 1]! - q[j + 1]!, p[i + 2]! - q[j + 2]!)

/** OKLab chroma of a colour (0 is grey; brand colours are usually over 0.06). */
export const chromaOf = (lab: readonly number[]) => Math.hypot(lab[1]!, lab[2]!)

export function clampBox(b: readonly number[], img: { width: number; height: number }): Box {
  return [
    Math.max(0, Math.min(img.width, Math.round(b[0]!))),
    Math.max(0, Math.min(img.height, Math.round(b[1]!))),
    Math.max(0, Math.min(img.width, Math.round(b[2]!))),
    Math.max(0, Math.min(img.height, Math.round(b[3]!))),
  ]
}

// ---------- clustering ----------

interface Cluster {
  lab: [number, number, number]
  rgb: [number, number, number]
  /** Pixels assigned. */
  n: number
  /** Pixels of the box's frame assigned. */
  frame: number
}

/** Pixels in OKLab (3 per pixel) and RGB (3 per pixel), plus a frame flag. */
interface Samples {
  lab: Float32Array
  rgb: Uint8Array
  frame: Uint8Array
  n: number
}

const Q = 0.03
export const binKey = (L: number, a: number, b: number) =>
  (Math.floor(L / Q) + 1) * 4096 + (Math.floor(a / Q) + 32) * 64 + (Math.floor(b / Q) + 32)

/**
 * Seeds from the fullest quantised bins, at least `apart` from each other,
 * then two rounds of nearest-centre assignment. Centres are the mean of the
 * members close to them, so a tail of mixed pixels does not drag a solid fill.
 */
function cluster(s: Samples, apart = 0.07, maxK = 8): Cluster[] {
  const bins = new Map<number, { n: number; L: number; a: number; b: number }>()
  for (let i = 0; i < s.n; i++) {
    const L = s.lab[i * 3]!
    const a = s.lab[i * 3 + 1]!
    const b = s.lab[i * 3 + 2]!
    const k = binKey(L, a, b)
    const e = bins.get(k)
    if (e) {
      e.n++
      e.L += L
      e.a += a
      e.b += b
    } else bins.set(k, { n: 1, L, a, b })
  }
  const sorted = [...bins.values()].sort((x, y) => y.n - x.n)
  const minSeed = Math.max(2, s.n * 0.003)
  const centres: [number, number, number][] = []
  for (const e of sorted) {
    if (e.n < minSeed || centres.length >= maxK) break
    const c: [number, number, number] = [e.L / e.n, e.a / e.n, e.b / e.n]
    if (centres.every((d) => Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]) >= apart))
      centres.push(c)
  }
  if (!centres.length) return []
  const assign = new Int16Array(s.n)
  let out: Cluster[] = []
  for (let round = 0; round < 3; round++) {
    const acc = centres.map(() => ({ n: 0, frame: 0, t: 0, L: 0, a: 0, b: 0, r: 0, g: 0, bl: 0 }))
    for (let i = 0; i < s.n; i++) {
      let best = 0
      let bd = Infinity
      for (let k = 0; k < centres.length; k++) {
        const c = centres[k]!
        const d = Math.hypot(
          s.lab[i * 3]! - c[0],
          s.lab[i * 3 + 1]! - c[1],
          s.lab[i * 3 + 2]! - c[2]
        )
        if (d < bd) {
          bd = d
          best = k
        }
      }
      assign[i] = best
      const e = acc[best]!
      e.n++
      if (s.frame[i]) e.frame++
      if (bd < 0.045) {
        e.t++
        e.L += s.lab[i * 3]!
        e.a += s.lab[i * 3 + 1]!
        e.b += s.lab[i * 3 + 2]!
        e.r += s.rgb[i * 3]!
        e.g += s.rgb[i * 3 + 1]!
        e.bl += s.rgb[i * 3 + 2]!
      }
    }
    out = []
    for (let k = 0; k < centres.length; k++) {
      const e = acc[k]!
      if (!e.n) continue
      if (e.t) centres[k] = [e.L / e.t, e.a / e.t, e.b / e.t]
      out.push({
        lab: [...centres[k]!],
        rgb: e.t ? [e.r / e.t, e.g / e.t, e.bl / e.t] : labToRgbApprox(centres[k]!),
        n: e.n,
        frame: e.frame,
      })
    }
  }
  return out.sort((x, y) => y.n - x.n)
}

/** OKLab back to sRGB (for a centre with no close members). */
export function labToRgbApprox([L, a, b]: readonly number[]): [number, number, number] {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3
  const m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3
  const s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return lin.map((v) => {
    const c = Math.min(1, Math.max(0, v))
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
  }) as [number, number, number]
}

/**
 * A cluster that is a blend of two others: it sits close to the segment
 * between them, away from both ends (anti-aliasing or JPEG ringing that
 * survived the edge filter).
 */
function isMix(c: Cluster, all: Cluster[]): boolean {
  for (const a of all) {
    if (a === c || a.n < c.n) continue
    for (const b of all) {
      if (b === c || b === a) continue
      const ab = [b.lab[0] - a.lab[0], b.lab[1] - a.lab[1], b.lab[2] - a.lab[2]]
      const len2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2
      if (len2 < 0.01) continue
      const ac = [c.lab[0] - a.lab[0], c.lab[1] - a.lab[1], c.lab[2] - a.lab[2]]
      const t = (ab[0]! * ac[0]! + ab[1]! * ac[1]! + ab[2]! * ac[2]!) / len2
      if (t < 0.12 || t > 0.88) continue
      const off = Math.hypot(ac[0]! - t * ab[0]!, ac[1]! - t * ab[1]!, ac[2]! - t * ab[2]!)
      if (off < 0.03) return true
    }
  }
  return false
}

/**
 * A box's pixels in OKLab without the anti-aliased ones: a pixel between two
 * opposite neighbours that differ (it lies on the line between them, away
 * from both) is a blend of an edge, not a colour of the element.
 */
function samples(img: Image, b: Box, maxSamples = 60_000): Samples {
  const L = labImage(img)
  const w = b[2] - b[0]
  const h = b[3] - b[1]
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / maxSamples)))
  const cap = Math.ceil(w / step) * Math.ceil(h / step)
  const lab = new Float32Array(cap * 3)
  const rgb = new Uint8Array(cap * 3)
  const frame = new Uint8Array(cap)
  const W = img.width
  const fw = Math.max(1, Math.round(Math.min(w, h) * 0.08))
  let n = 0
  const between = (i: number, p: number, q: number) => {
    const pq = dist3(L, p * 3, L, q * 3)
    if (pq < 0.08) return false
    const ip = dist3(L, i * 3, L, p * 3)
    const iq = dist3(L, i * 3, L, q * 3)
    return ip + iq <= pq * 1.2 && Math.min(ip, iq) > 0.15 * pq
  }
  for (let y = b[1]; y < b[3]; y += step) {
    for (let x = b[0]; x < b[2]; x += step) {
      const i = y * W + x
      if (x > 0 && x < W - 1 && between(i, i - 1, i + 1)) continue
      if (y > 0 && y < img.height - 1 && between(i, i - W, i + W)) continue
      lab[n * 3] = L[i * 3]!
      lab[n * 3 + 1] = L[i * 3 + 1]!
      lab[n * 3 + 2] = L[i * 3 + 2]!
      rgb[n * 3] = img.data[i * 4]!
      rgb[n * 3 + 1] = img.data[i * 4 + 1]!
      rgb[n * 3 + 2] = img.data[i * 4 + 2]!
      frame[n] = x - b[0] < fw || b[2] - 1 - x < fw || y - b[1] < fw || b[3] - 1 - y < fw ? 1 : 0
      n++
    }
  }
  return { lab, rgb, frame, n }
}

const swatch = (c: Cluster, total: number): Swatch => ({
  hex: hex(c.rgb),
  rgb: [Math.round(c.rgb[0]), Math.round(c.rgb[1]), Math.round(c.rgb[2])],
  lab: c.lab,
  share: total ? c.n / total : 0,
})

export const labDist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

// ---------- fill and ink ----------

export interface FillAndInk {
  fill: Swatch | null
  ink: Swatch | null
  /** OKLab distance between fill and ink (0 when there is no ink). */
  contrast: number
}

export interface FillAndInkOptions {
  /**
   * `text`: the box hugs text, so it is grown a little and the fill is the
   * colour of its frame (heavy type can cover more of a tight box than its
   * background). `element` (default): the fill is the largest cluster.
   */
  mode?: 'element' | 'text'
}

/** An element's fill and its text colour. */
export function fillAndInk(
  img: Image,
  box: readonly number[] | null,
  opts: FillAndInkOptions = {}
): FillAndInk {
  const none = { fill: null, ink: null, contrast: 0 }
  if (!box) return none
  let b = clampBox(box, img)
  if (opts.mode === 'text') {
    const m = Math.max(2, Math.round((b[3] - b[1]) * 0.15))
    b = clampBox([b[0] - m, b[1] - m, b[2] + m, b[3] + m], img)
  }
  if (b[2] - b[0] < 2 || b[3] - b[1] < 2) return none
  const s = samples(img, b)
  if (!s.n) return none
  const all = cluster(s)
  if (!all.length) return none
  const fillC =
    opts.mode === 'text'
      ? all.reduce((x, y) => (y.frame > x.frame || (y.frame === x.frame && y.n > x.n) ? y : x))
      : all[0]!
  // An element's label sits in its middle: rounded ends and corners can show what is behind it (a photo).
  let inner = s
  let innerAll = all
  if (opts.mode !== 'text') {
    const h = b[3] - b[1]
    const ix = Math.round(Math.min(h * 0.5, (b[2] - b[0]) * 0.25))
    const iy = Math.round(h * 0.15)
    const ib: Box = [b[0] + ix, b[1] + iy, b[2] - ix, b[3] - iy]
    if (ib[2] - ib[0] >= 4 && ib[3] - ib[1] >= 4) {
      inner = samples(img, ib)
      innerAll = cluster(inner)
    }
  }
  const fillIn = innerAll.reduce<Cluster | null>(
    (x, y) => (!x || labDist(y.lab, fillC.lab) < labDist(x.lab, fillC.lab) ? y : x),
    null
  )
  const minority = innerAll.filter((c) => c !== fillIn && !isMix(c, innerAll))
  const biggest = Math.max(0, ...minority.map((c) => c.n))
  const floor = Math.max(3, inner.n * 0.006, biggest * 0.15)
  let inkC: Cluster | null = null
  let best = 0
  for (const c of minority) {
    if (c.n < floor) continue
    const d = labDist(c.lab, fillC.lab)
    if (d > best) {
      best = d
      inkC = c
    }
  }
  const ink = inkC ? inkCore(inner, fillC, inkC) : null
  return {
    fill: swatch(fillC, s.n),
    ink,
    contrast: ink ? labDist(ink.lab, fillC.lab) : 0,
  }
}

/**
 * The ink's own colour from the stroke cores: thin type (small text, a
 * downscaled or compressed screenshot) has few pixels at full ink, so the
 * cluster centre reads lighter than the ink. The pixels furthest along the
 * line from the fill to the ink cluster are its cores.
 */
function inkCore(s: Samples, fill: Cluster, ink: Cluster): Swatch {
  const d = [ink.lab[0] - fill.lab[0], ink.lab[1] - fill.lab[1], ink.lab[2] - fill.lab[2]]
  const len2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2
  const len = Math.sqrt(len2)
  const along: { t: number; i: number }[] = []
  for (let i = 0; i < s.n; i++) {
    const p = [
      s.lab[i * 3]! - fill.lab[0],
      s.lab[i * 3 + 1]! - fill.lab[1],
      s.lab[i * 3 + 2]! - fill.lab[2],
    ]
    const t = (p[0]! * d[0]! + p[1]! * d[1]! + p[2]! * d[2]!) / len2
    if (t < 0.5) continue
    const off = Math.hypot(p[0]! - t * d[0]!, p[1]! - t * d[1]!, p[2]! - t * d[2]!)
    if (off > 0.04 + 0.15 * len * t) continue
    along.push({ t, i })
  }
  if (along.length < 3) return swatch(ink, s.n)
  along.sort((a, b) => b.t - a.t)
  const top = along.slice(0, Math.max(3, Math.ceil(along.length * 0.12)))
  const c = [0, 0, 0, 0, 0, 0]
  for (const { i } of top) {
    for (let q = 0; q < 3; q++) {
      c[q] += s.lab[i * 3 + q]!
      c[q + 3] += s.rgb[i * 3 + q]!
    }
  }
  const k = top.length
  const rgb: RGB = [c[3]! / k, c[4]! / k, c[5]! / k]
  return {
    hex: hex(rgb),
    rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])],
    lab: [c[0]! / k, c[1]! / k, c[2]! / k],
    share: ink.n / s.n,
  }
}

export interface BoxColours {
  background: Swatch | null
  /** Ink colours over the background, shares of the ink (not of the box), largest first. */
  colours: Swatch[]
}

/**
 * Every ink colour over a box's background (the colour holding its frame),
 * anti-aliased blends left out. For a logo: its own colours and shares.
 */
export function boxColours(img: Image, box: readonly number[] | null, minShare = 0.06): BoxColours {
  if (!box) return { background: null, colours: [] }
  const b0 = clampBox(box, img)
  const m = Math.max(2, Math.round((b0[3] - b0[1]) * 0.1))
  const b = clampBox([b0[0] - m, b0[1] - m, b0[2] + m, b0[3] + m], img)
  if (b[2] - b[0] < 2 || b[3] - b[1] < 2) return { background: null, colours: [] }
  const s = samples(img, b)
  const all = cluster(s)
  if (!all.length) return { background: null, colours: [] }
  const bg = all.reduce((x, y) => (y.frame > x.frame ? y : x))
  const inks = all.filter((c) => c !== bg && !isMix(c, all))
  const total = inks.reduce((t, c) => t + c.n, 0)
  return {
    background: swatch(bg, s.n),
    colours: inks
      .map((c) => swatch(c, total))
      .filter((c) => c.share >= minShare)
      .sort((x, y) => y.share - x.share),
  }
}
