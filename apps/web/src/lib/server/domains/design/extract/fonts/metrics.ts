/**
 * Text metrics from pixels, pure TS over RGBA. A text box becomes an ink
 * coverage mask (0..1 per pixel, anti-aliasing kept), split into lines and
 * words; each line gives baseline, x-height, tall height (caps/ascenders),
 * stem width, horizontal stroke (contrast) and width. The same functions run
 * on rendered candidates, so screenshot and render are measured alike.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { okDist, type RGB } from '../color'
import type { Box } from '../kinds'
import type { Image } from '../png'
import { frameStats } from '../snap'

export interface Mask {
  w: number
  h: number
  a: Float32Array
}

export interface InkResult {
  mask: Mask
  x0: number
  y0: number
  bg: RGB
  ink: RGB
  frameShare: number
}

const px = (img: Image, x: number, y: number): RGB => {
  const o = (y * img.width + x) * 4
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
}

/** The ground around a box: the frame's commonest colour, on this share of it at least. */
const GROUND_SHARE = 0.25
/** How near (OKLab) a colour is to the ground to be the ground. */
const GROUND_NEAR = 0.05

/**
 * Ink coverage inside a box. Background is the colour of a frame just outside
 * the box; ink is the mean of the 8% of pixels farthest from it. Coverage is
 * each pixel's projection on the background-to-ink line; pixels far off that
 * line (a gradient or photo behind the text) count as background.
 */
export function inkMask(img: Image, box: number[], pad = 3, dpr = 1): InkResult {
  const x0 = Math.max(0, Math.floor(box[0]!)),
    y0 = Math.max(0, Math.floor(box[1]!))
  const x1 = Math.min(img.width, Math.ceil(box[2]!)),
    y1 = Math.min(img.height, Math.ceil(box[3]!))
  const frame: Box = [
    Math.max(0, x0 - pad),
    Math.max(0, y0 - pad),
    Math.min(img.width, x1 + pad),
    Math.min(img.height, y1 + pad),
  ]
  const fr = frameStats(img, frame)
  const bg = fr.colour
  const w = x1 - x0,
    h = y1 - y0
  const P = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = px(img, x0 + x, y0 + y)
      P.set(p, (y * w + x) * 3)
    }
  let ink: RGB
  if (fr.share >= 0.5) {
    // Plain background: ink is the mean of the 8% of pixels farthest from it.
    const d = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) d[i] = okDist([P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!], bg)
    const cut = Float32Array.from(d).sort()[Math.floor(d.length * 0.92)]!
    const acc = [0, 0, 0]
    let n = 0
    for (let i = 0; i < w * h; i++)
      if (d[i]! >= cut && cut > 0.05) {
        acc[0] += P[i * 3]!
        acc[1] += P[i * 3 + 1]!
        acc[2] += P[i * 3 + 2]!
        n++
      }
    ink = n ? [acc[0]! / n, acc[1]! / n, acc[2]! / n] : [0, 0, 0]
  } else {
    // Busy background (photo, gradient): text set on it is an extreme (light
    // on dark or dark on light); take the side of the luminance range farther
    // from the box's median, and the mean of its outer 2%. A side the colour
    // of the ground around the box is that ground showing inside it, not the
    // text: dark words across a coloured shape on a light page have the shape
    // for the box's median and the page for its light side.
    const lum = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++)
      lum[i] = 0.299 * P[i * 3]! + 0.587 * P[i * 3 + 1]! + 0.114 * P[i * 3 + 2]!
    const s = Float32Array.from(lum).sort()
    const med = s[Math.floor(s.length / 2)]!,
      lo = s[Math.floor(s.length * 0.02)]!,
      hi = s[Math.floor(s.length * 0.98)]!
    const side = (light: boolean): RGB => {
      const acc = [0, 0, 0, 0]
      for (let i = 0; i < w * h; i++)
        if (light ? lum[i]! >= hi : lum[i]! <= lo)
          for (let k = 0; k < 4; k++) acc[k] += k < 3 ? P[i * 3 + k]! : 1
      return [acc[0]! / acc[3]!, acc[1]! / acc[3]!, acc[2]! / acc[3]!]
    }
    const light = hi - med > med - lo
    const ground = (c: RGB) => fr.share >= GROUND_SHARE && okDist(c, bg) < GROUND_NEAR
    ink = ground(side(light)) && !ground(side(!light)) ? side(!light) : side(light)
  }
  // Local background: in a window around each pixel, the pixel farthest from
  // the ink (separable max filter on distance-from-ink). Coverage is the
  // pixel's projection from that local background towards the ink.
  const r = Math.max(2, Math.round(4 * dpr))
  const dist = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++)
    dist[i] =
      (P[i * 3]! - ink[0]) ** 2 + (P[i * 3 + 1]! - ink[1]) ** 2 + (P[i * 3 + 2]! - ink[2]) ** 2
  const rowArg = new Int32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = y * w + x
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++)
        if (dist[y * w + k]! > dist[best]!) best = y * w + k
      rowArg[y * w + x] = best
    }
  const arg = new Int32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = rowArg[y * w + x]!
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        const c = rowArg[k * w + x]!
        if (dist[c]! > dist[best]!) best = c
      }
      arg[y * w + x] = best
    }
  const plainBg = fr.share >= 0.5
  const gvv = (ink[0] - bg[0]) ** 2 + (ink[1] - bg[1]) ** 2 + (ink[2] - bg[2]) ** 2
  const a = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const j = arg[i]!
    let lb: number[] = [P[j * 3]!, P[j * 3 + 1]!, P[j * 3 + 2]!]
    let vv = dist[j]!
    // A window entirely inside a thick stroke, or a plain box: fall back to the frame colour.
    if (plainBg && vv < 0.5 * gvv) {
      lb = bg
      vv = gvv
    }
    if (vv < 400) {
      a[i] = dist[i]! < 400 ? 1 : 0
      continue
    }
    const v = [ink[0] - lb[0]!, ink[1] - lb[1]!, ink[2] - lb[2]!]
    const q = [P[i * 3]! - lb[0]!, P[i * 3 + 1]! - lb[1]!, P[i * 3 + 2]! - lb[2]!]
    const t = (q[0]! * v[0]! + q[1]! * v[1]! + q[2]! * v[2]!) / vv
    const perp = Math.sqrt(Math.max(0, q[0]! ** 2 + q[1]! ** 2 + q[2]! ** 2 - t * t * vv))
    a[i] = perp > 0.5 * Math.sqrt(vv) ? 0 : Math.min(1, Math.max(0, t))
  }
  // Denoise: a faint pixel with no solid neighbour is background texture, not an anti-aliased edge.
  const clean = new Float32Array(a)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (a[i]! >= 0.6 || a[i] === 0) continue
      let solid = false
      for (let dy = -1; dy <= 1 && !solid; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy,
            xx = x + dx
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && a[yy * w + xx]! >= 0.6) {
            solid = true
            break
          }
        }
      if (!solid) clean[i] = 0
    }
  return { mask: { w, h, a: clean }, x0, y0, bg, ink, frameShare: fr.share }
}

export function subMask(m: Mask, x0: number, y0: number, x1: number, y1: number): Mask {
  const w = x1 - x0,
    h = y1 - y0,
    a = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) a[y * w + x] = m.a[(y0 + y) * m.w + x0 + x]!
  return { w, h, a }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/** Row bands of ink: each a text line (accents and dots merged in, over-tall bands split). */
/**
 * Each line's rows, top to bottom: rows with more than floorShare of the
 * inkiest row's ink. A photo's edge or close leading can bridge two lines at
 * the usual floor; a higher one parts them.
 */
export function lineBands(m: Mask, floorShare = 0.04): Array<[number, number]> {
  const rows = new Float32Array(m.h)
  for (let y = 0; y < m.h; y++) {
    let s = 0
    for (let x = 0; x < m.w; x++) s += m.a[y * m.w + x]! > 0.5 ? 1 : 0
    rows[y] = s
  }
  let rmax = 0
  for (let y = 0; y < m.h; y++) rmax = Math.max(rmax, rows[y]!)
  const floor = Math.max(0.5, floorShare * rmax)
  let bands: Array<[number, number]> = []
  let start = -1
  for (let y = 0; y <= m.h; y++) {
    const on = y < m.h && rows[y]! > floor
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      bands.push([start, y])
      start = -1
    }
  }
  if (!bands.length) return []
  // Merge slivers (dots, accents, underline fragments) into the nearest band.
  const tallest = Math.max(...bands.map(([a, b]) => b - a))
  const mh = median(bands.map(([a, b]) => b - a).filter((x) => x >= 0.5 * tallest))
  for (let changed = true; changed && bands.length > 1;) {
    changed = false
    const i = bands.findIndex(([a, b]) => b - a < 0.35 * mh)
    if (i < 0) break
    const [a, b] = bands[i]!
    const prev = bands[i - 1],
      next = bands[i + 1]
    const dp = prev ? a - prev[1] : Infinity,
      dn = next ? next[0] - b : Infinity
    if (dp <= dn && prev) {
      prev[1] = b
      bands.splice(i, 1)
    } else if (next) {
      next[0] = a
      bands.splice(i, 1)
    }
    changed = true
  }
  // Split touching lines: a band much taller than the others splits at its emptiest row.
  const out: Array<[number, number]> = []
  const ref = median(bands.map(([a, b]) => b - a).filter((x) => x >= 0.5 * mh))
  for (const [a, b] of bands) {
    if (bands.length > 1 && b - a > 1.7 * ref) {
      const lo = a + Math.floor(0.3 * (b - a)),
        hi = a + Math.ceil(0.7 * (b - a))
      let best = lo
      for (let y = lo; y < hi; y++) if (rows[y]! < rows[best]!) best = y
      out.push([a, best], [best + 1, b])
    } else out.push([a, b])
  }
  bands = out
  // Grow each core band over its faint rows (descenders, accents), never past the midpoint to the next.
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!
    const upLimit = i > 0 ? Math.ceil((bands[i - 1]![1] + b[0]) / 2) : 0
    const downLimit = i + 1 < bands.length ? Math.floor((b[1] + bands[i + 1]![0]) / 2) : m.h
    while (b[0] > upLimit && rows[b[0] - 1]! > 0) b[0]--
    while (b[1] < downLimit && rows[b[1]]! > 0) b[1]++
  }
  return bands
}

export interface LineMetrics {
  top: number // band top within the mask
  bottom: number
  baseline: number // row just below the bulk of the ink (mask coords)
  xTop: number
  tallTop: number
  xHeight: number
  tall: number // caps / ascender height
  stem: number // median vertical stem width, px
  hstroke: number // median horizontal stroke thickness, px
  left: number
  right: number
  width: number
  ink: number // total coverage
  gaps: Array<[number, number]> // inner ink-free column runs [start, end)
  inkCols: number // width minus inner gaps: glyph widths, free of letter-spacing
  upperLike: boolean // no x-height step: caps or a unicase face
}

/** Metrics of one line band. */
export function lineMetrics(m: Mask, top: number, bottom: number): LineMetrics {
  const H = bottom - top
  const rows = new Float32Array(H)
  for (let y = 0; y < H; y++) {
    let s = 0
    for (let x = 0; x < m.w; x++) s += m.a[(top + y) * m.w + x]!
    rows[y] = s
  }
  let peak = 0
  for (let y = 0; y < H; y++) if (rows[y]! > rows[peak]!) peak = y
  const mx = rows[peak]!
  // Baseline: below the peak, the first row whose ink falls under 30% of the peak.
  let baseline = H
  for (let y = peak; y < H; y++)
    if (rows[y]! < 0.3 * mx) {
      baseline = y
      break
    }
  let xTop = 0
  for (let y = 0; y < H; y++)
    if (rows[y]! >= 0.45 * mx) {
      xTop = y
      break
    }
  let tallTop = 0
  for (let y = 0; y < H; y++)
    if (rows[y]! >= 0.06 * mx) {
      tallTop = y
      break
    }
  // Sub-pixel edges from the profile's fractional rows.
  const frac = (y: number, level: number) => {
    const v = rows[y]!
    return Math.min(1, Math.max(0, v / Math.max(1e-6, level)))
  }
  const tallTopF = tallTop + 1 - frac(tallTop, rows[Math.min(H - 1, tallTop + 1)]!)
  const xh = baseline - xTop
  const tall = baseline - tallTopF
  // Columns.
  const cols = new Float32Array(m.w)
  for (let x = 0; x < m.w; x++) {
    let s = 0
    for (let y = top; y < bottom; y++) {
      const c = m.a[y * m.w + x]!
      s += c > 0.5 ? c : 0
    }
    cols[x] = s
  }
  let left = 0
  while (left < m.w && cols[left]! < 0.5) left++
  let right = m.w - 1
  while (right > 0 && cols[right]! < 0.5) right--
  const gaps: Array<[number, number]> = []
  let gs = -1
  for (let x = left; x <= right + 1; x++) {
    const empty = x <= right && cols[x]! < 0.5
    if (empty && gs < 0) gs = x
    if (!empty && gs >= 0) {
      gaps.push([gs, x])
      gs = -1
    }
  }
  // Stems: horizontal runs (coverage-summed) across the middle of the x-height.
  const runs: number[] = []
  const y0 = top + xTop + Math.round(0.3 * xh),
    y1 = top + baseline - Math.round(0.3 * xh)
  for (let y = y0; y <= Math.max(y0, y1); y++) {
    let s = 0,
      on = false
    for (let x = 0; x <= m.w; x++) {
      const c = x < m.w ? m.a[y * m.w + x]! : 0
      if (c > 0.08) {
        s += c
        on = true
      } else if (on) {
        runs.push(s)
        s = 0
        on = false
      }
    }
  }
  const med = median(runs)
  const stem = median(runs.filter((r) => r < 2.2 * med && r > 0.3 * med))
  // Horizontal strokes: vertical runs inside the x band shorter than half the x-height.
  const vr: number[] = []
  for (let x = left; x <= right; x++) {
    let s = 0,
      on = false,
      len = 0
    for (let y = top + xTop - 1; y <= top + baseline + 1; y++) {
      const c = y >= 0 && y < m.h ? m.a[y * m.w + x]! : 0
      if (c > 0.08) {
        s += c
        on = true
        len++
      } else if (on) {
        if (len < 0.45 * xh) vr.push(s)
        s = 0
        on = false
        len = 0
      }
    }
  }
  const hstroke = median(vr)
  let ink = 0
  for (let y = top; y < bottom; y++) for (let x = 0; x < m.w; x++) ink += m.a[y * m.w + x]!
  return {
    top,
    bottom,
    baseline: top + baseline,
    xTop: top + xTop,
    tallTop: top + tallTopF,
    xHeight: xh,
    tall,
    stem,
    hstroke,
    left,
    right: right + 1,
    width: right + 1 - left,
    ink,
    gaps,
    inkCols: right + 1 - left - gaps.reduce((t, g) => t + g[1] - g[0], 0),
    upperLike: xh / Math.max(1, tall) > 0.86,
  }
}

export interface TextMetrics {
  lines: LineMetrics[]
  xHeight: number // medians across lines, image px
  tall: number
  stem: number
  hstroke: number
  upperLike: boolean
  /** Words per line, from the widest inner gaps (needs the word count). */
  wordsPerLine?: number[]
}

export function textMetrics(m: Mask, wordCount?: number, floorShare?: number): TextMetrics {
  const bands = lineBands(m, floorShare)
  const lines = bands.map(([a, b]) => lineMetrics(m, a, b)).filter((l) => l.width > 2 && l.tall > 2)
  const wsum = (f: (l: LineMetrics) => number) => {
    let s = 0,
      n = 0
    for (const l of lines) {
      s += f(l) * l.width
      n += l.width
    }
    return n ? s / n : 0
  }
  const out: TextMetrics = {
    lines,
    xHeight: wsum((l) => l.xHeight),
    tall: wsum((l) => l.tall),
    stem: wsum((l) => l.stem),
    hstroke: wsum((l) => l.hstroke),
    upperLike: lines.filter((l) => l.upperLike).length > lines.length / 2,
  }
  if (wordCount && lines.length) out.wordsPerLine = splitWords(lines, wordCount)
  return out
}

/** Word gaps are the K widest inner gaps across all lines, K = words - lines. */
export function splitWords(lines: LineMetrics[], words: number): number[] {
  const k = words - lines.length
  const all = lines.flatMap((l, i) => l.gaps.map((g) => ({ i, g, w: g[1] - g[0] })))
  all.sort((a, b) => b.w - a.w)
  const counts = lines.map(() => 1)
  for (const { i } of all.slice(0, Math.max(0, k))) counts[i]!++
  return counts
}

/** The word gaps of a line given how many words it holds: its widest inner gaps, in order. */
export function wordGaps(l: LineMetrics, words: number): Array<[number, number]> {
  return [...l.gaps]
    .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
    .slice(0, Math.max(0, words - 1))
    .sort((a, b) => a[0] - b[0])
}
