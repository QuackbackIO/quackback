/**
 * Text metrics from pixels: inside a trimmed text box (a snapped headline,
 * menu item or button label), the ink and frame colours, then per line the
 * baseline, the tall height (capitals or ascenders), the x-height, the stroke
 * width, and between lines the line height; from those the size in CSS px,
 * a weight estimate, whether the text is set in capitals, and a letter
 * spacing estimate when the words are known.
 *
 * Size is the tall height (capitals or ascenders, whichever the line's
 * tallest letters are) over the face's tall-height ratio: 0.73 until a font
 * matcher names the face and supplies its own.
 * Weight is the stem width over the tall height, read on a table measured on
 * bundled sans faces drawn by Chromium (300 is 0.08, 400 is 0.115, 700 is
 * 0.2), so it does not depend on the face's x-height.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { okDist, type RGB } from './color'
import type { Box } from './kinds'
import type { Image } from './png'
import { frameStats } from './snap'

/** Ink coverage of a region: 0 is the background, 1 the ink; anti-aliased edges in between. */
export interface Coverage {
  /** The region, in image pixels. */
  box: Box
  w: number
  h: number
  a: Float32Array
  ink: RGB
  frame: RGB
  /** Share of the frame in its main colour: under 0.5 is a photo, gradient or busy art. */
  frameShare: number
}

const px = (img: Image, x: number, y: number): RGB => {
  const o = (y * img.width + x) * 4
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
}

const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

const clampBox = (b: readonly number[], img: Image): Box => [
  Math.max(0, Math.floor(b[0]!)),
  Math.max(0, Math.floor(b[1]!)),
  Math.min(img.width, Math.ceil(b[2]!)),
  Math.min(img.height, Math.ceil(b[3]!)),
]

/**
 * Coverage of the ink inside a box against the colour of its frame (2px just
 * outside it). The ink is the mean of the pixels farthest from the frame
 * colour (the outer 8%); on a busy frame, the luminance extreme farther from
 * the box's median. Each pixel's coverage is its projection on the line from
 * the frame colour to the ink; a pixel far off that line (another colour,
 * such as an emoji or a photo) counts as background.
 */
export function coverage(img: Image, box: readonly number[], pad = 2): Coverage | null {
  const b = clampBox(box, img)
  const w = b[2] - b[0]
  const h = b[3] - b[1]
  if (w < 2 || h < 2) return null
  const fr = frameStats(img, clampBox([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], img))
  const P: RGB[] = []
  for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) P.push(px(img, x, y))
  let frame = fr.colour
  let ink: RGB
  const mean = (pick: (i: number) => boolean): RGB | null => {
    const s = [0, 0, 0]
    let n = 0
    for (let i = 0; i < P.length; i++) {
      if (!pick(i)) continue
      s[0] += P[i]![0]
      s[1] += P[i]![1]
      s[2] += P[i]![2]
      n++
    }
    return n ? [s[0]! / n, s[1]! / n, s[2]! / n] : null
  }
  if (fr.share >= 0.5) {
    const d = P.map((p) => okDist(p, frame))
    const cut = [...d].sort((x, y) => x - y)[Math.floor(d.length * 0.92)]!
    if (cut < 0.05) return null
    ink = mean((i) => d[i]! >= cut)!
  } else {
    const lum = P.map((p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2])
    const s = [...lum].sort((x, y) => x - y)
    const med = s[Math.floor(s.length / 2)]!
    const lo = s[Math.floor(s.length * 0.02)]!
    const hi = s[Math.floor(s.length * 0.98)]!
    const light = hi - med > med - lo
    ink = mean((i) => (light ? lum[i]! >= hi : lum[i]! <= lo))!
    frame = mean((i) => Math.abs(lum[i]! - med) < 12) ?? frame
  }
  const v: RGB = [ink[0] - frame[0], ink[1] - frame[1], ink[2] - frame[2]]
  const vv = v[0] ** 2 + v[1] ** 2 + v[2] ** 2
  if (vv < 400) return null
  const a = new Float32Array(w * h)
  for (let i = 0; i < P.length; i++) {
    const q = [P[i]![0] - frame[0], P[i]![1] - frame[1], P[i]![2] - frame[2]]
    const t = (q[0]! * v[0] + q[1]! * v[1] + q[2]! * v[2]) / vv
    const perp = Math.sqrt(Math.max(0, q[0]! ** 2 + q[1]! ** 2 + q[2]! ** 2 - t * t * vv))
    a[i] = perp > 0.5 * Math.sqrt(vv) ? 0 : Math.min(1, Math.max(0, t))
  }
  return { box: b, w, h, a, ink, frame, frameShare: fr.share }
}

/** One line of text, in pixels of the coverage region. */
export interface LineMetrics {
  top: number
  bottom: number
  /** The row just under the bulk of the ink (sub-pixel). */
  baseline: number
  /** Height of the tallest letters (capitals or ascenders) above the baseline. */
  tall: number
  xHeight: number
  /** Median width of the vertical stems, coverage summed. */
  stem: number
  left: number
  right: number
  /** Ink-free column runs inside the line: letter and word gaps. */
  gaps: Array<[number, number]>
}

/** Row bands of ink, one per line: accents and dots merged into their line, touching lines split. */
export function lineBands(c: Coverage): Array<[number, number]> {
  const rows = new Float32Array(c.h)
  const faint = new Float32Array(c.h)
  for (let y = 0; y < c.h; y++) {
    let s = 0
    let f = 0
    for (let x = 0; x < c.w; x++) {
      const v = c.a[y * c.w + x]!
      s += v > 0.5 ? 1 : 0
      f += v
    }
    rows[y] = s
    faint[y] = f
  }
  const rmax = Math.max(0, ...rows)
  const floor = Math.max(0.5, 0.04 * rmax)
  let bands: Array<[number, number]> = []
  let start = -1
  for (let y = 0; y <= c.h; y++) {
    const on = y < c.h && rows[y]! > floor
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      bands.push([start, y])
      start = -1
    }
  }
  if (!bands.length) return []
  const tallest = Math.max(...bands.map(([a, b]) => b - a))
  const mh = median(bands.map(([a, b]) => b - a).filter((x) => x >= 0.5 * tallest))
  // Slivers (dots, accents, underline pieces) join the nearer band when they touch it;
  // a sliver further off is something else (a small line of text above, a rule) and is dropped.
  while (bands.length > 1) {
    const i = bands.findIndex(([a, b]) => b - a < 0.35 * mh)
    if (i < 0) break
    const [a, b] = bands[i]!
    const prev = bands[i - 1]
    const next = bands[i + 1]
    const dp = prev ? a - prev[1] : Infinity
    const dn = next ? next[0] - b : Infinity
    if (Math.min(dp, dn) <= 0.25 * mh) {
      if (prev && dp <= dn) prev[1] = b
      else if (next) next[0] = a
    }
    bands.splice(i, 1)
  }
  // A band much taller than the rest is two touching lines: split at its emptiest row.
  const ref = median(bands.map(([a, b]) => b - a).filter((x) => x >= 0.5 * mh))
  const out: Array<[number, number]> = []
  for (const [a, b] of bands) {
    if (bands.length > 1 && b - a > 1.7 * ref) {
      const lo = a + Math.floor(0.3 * (b - a))
      const hi = a + Math.ceil(0.7 * (b - a))
      let best = lo
      for (let y = lo; y < hi; y++) if (rows[y]! < rows[best]!) best = y
      out.push([a, best], [best + 1, b])
    } else out.push([a, b])
  }
  bands = out
  // Grow each band over its faint rows (descenders, anti-aliasing), never past halfway to the next.
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!
    const up = i > 0 ? Math.ceil((bands[i - 1]![1] + b[0]) / 2) : 0
    const down = i + 1 < bands.length ? Math.floor((b[1] + bands[i + 1]![0]) / 2) : c.h
    while (b[0] > up && faint[b[0] - 1]! >= 0.3) b[0]--
    while (b[1] < down && faint[b[1]]! >= 0.3) b[1]++
  }
  return bands
}

/**
 * Metrics of one line band from its row profile (ink summed across the
 * line): the baseline is the sharpest fall in the lower part (descenders
 * leave a little ink under it), the x-height's top the sharpest rise between
 * the tallest letters' top and the baseline, each placed to a fraction of a
 * pixel from the partly covered row at the edge. A line with no rise below
 * its top is capitals (or a face that draws lower case as them).
 */
export function lineMetrics(c: Coverage, top: number, bottom: number): LineMetrics {
  const H = bottom - top
  // One empty row past the band, so a line with no descenders falls at its foot.
  const r = new Float32Array(H + 1)
  // Solid pixels per row: a busy background's faint coverage does not count.
  const n = new Float32Array(H + 1)
  for (let y = 0; y < H; y++) {
    let s = 0
    let k = 0
    for (let x = 0; x < c.w; x++) {
      const v = c.a[(top + y) * c.w + x]!
      s += v
      if (v > 0.5) k++
    }
    r[y] = s
    n[y] = k
  }
  const peak = Math.max(0, ...r)
  const peakN = Math.max(0, ...n)
  const solid = (y: number) => n[y]! >= Math.max(1, 0.02 * peakN)
  // First guess at the top: the first row with solid ink.
  let t = 0
  while (t < H && !solid(t)) t++
  // Edges are read over two rows (an edge's anti-aliasing can spread over two, as on a
  // retina capture): the place where the profile crosses halfway between the levels on
  // either side, between row centres, is the edge to a fraction of a pixel.
  const cross = (y: number) => {
    const a = r[y]!
    const b = r[y + 2] ?? 0
    const mid = (a + b) / 2
    const m1 = r[y + 1]!
    const lo = (mid - a) / (m1 - a || 1e-6)
    const hi = (mid - m1) / (b - m1 || 1e-6)
    // Crossing between rows y and y+1, or between y+1 and y+2 (row centres at +0.5).
    if ((m1 - mid) * (a - mid) <= 0) return y + 0.5 + Math.min(1, Math.max(0, lo))
    return y + 1.5 + Math.min(1, Math.max(0, hi))
  }
  // Baseline: the largest fall over two rows, in the lower half (below crossbars).
  let bi = -1
  let bestFall = 0
  for (let y = Math.max(t + 1, Math.floor(t + 0.5 * (H - t))); y + 1 <= H; y++) {
    const fall = r[y]! - (r[y + 2] ?? 0)
    if (fall > bestFall) {
      bestFall = fall
      bi = y
    }
  }
  const baseline = bi >= 0 ? cross(bi) : H
  // x-height: the largest rise over two rows between the top and the upper part of the line.
  let xi = -1
  let bestRise = 0
  for (let y = t; y + 2 < baseline - 0.3 * (baseline - t); y++) {
    const rise = r[y + 2]! - r[y]!
    if (rise > bestRise) {
      bestRise = rise
      xi = y
    }
  }
  // The tallest letters rise from the x-height without a break: from there up to the last
  // solid row, so a line of smaller text above or the last line's descenders are left out.
  let from = Math.floor(baseline) - 1
  if (xi >= 0 && bestRise > 0.25 * peak) from = xi + 2
  t = Math.max(0, Math.min(from, H - 1))
  while (t > 0 && solid(t - 1)) t--
  // The row above is partly covered by the same letters: its coverage over the noise floor.
  let floor = t > 1 ? Infinity : 0
  for (let y = 0; y < t - 1; y++) floor = Math.min(floor, r[y]!)
  const part = t > 0 && t < H ? (r[t - 1]! - floor) / Math.max(1e-6, r[t]! - floor) : 0
  const tallTop = t - Math.min(1, Math.max(0, part))
  const tall = baseline - tallTop
  const xTop = xi >= 0 && bestRise > 0.25 * peak ? Math.max(tallTop, cross(xi)) : tallTop
  const xHeight = baseline - xTop
  // Columns: ink-free runs between the first and last inked column.
  const cols = new Float32Array(c.w)
  for (let x = 0; x < c.w; x++) {
    let s = 0
    for (let y = top; y < bottom; y++) {
      const v = c.a[y * c.w + x]!
      s += v > 0.5 ? v : 0
    }
    cols[x] = s
  }
  let left = 0
  while (left < c.w && cols[left]! < 0.5) left++
  let right = c.w - 1
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
  // Stems: coverage-summed horizontal runs across the middle of the x-height.
  const runs: number[] = []
  const y0 = top + Math.round(baseline - 0.7 * xHeight)
  const y1 = top + Math.round(baseline - 0.3 * xHeight)
  for (let y = Math.max(top, y0); y <= Math.min(bottom - 1, y1); y++) {
    let s = 0
    let inRun = false
    for (let x = 0; x <= c.w; x++) {
      const v = x < c.w ? c.a[y * c.w + x]! : 0
      if (v > 0.08) {
        s += v
        inRun = true
      } else if (inRun) {
        runs.push(s)
        s = 0
        inRun = false
      }
    }
  }
  const med = median(runs)
  const stem = median(runs.filter((v) => v < 2.2 * med && v > 0.3 * med))
  return {
    top,
    bottom,
    baseline: top + baseline,
    tall,
    xHeight,
    stem,
    left,
    right: right + 1,
    gaps,
  }
}

/** Stem width over tall height to CSS weight, measured on bundled sans faces drawn by Chromium. */
const WEIGHT_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0.0586, 200],
  [0.0799, 300],
  [0.1148, 400],
  [0.1437, 500],
  [0.1734, 600],
  [0.1993, 700],
  [0.23, 800],
  [0.2628, 900],
]

/** A CSS weight (100 to 900, not rounded) from a line's stem width over its tall height. */
export function weightFromStem(stemPerTall: number): number {
  const t = WEIGHT_TABLE
  if (stemPerTall <= t[0]![0])
    return Math.max(100, t[0]![1] - ((t[0]![0] - stemPerTall) / 0.02) * 100)
  for (let i = 1; i < t.length; i++) {
    if (stemPerTall <= t[i]![0]) {
      const [r0, w0] = t[i - 1]!
      const [r1, w1] = t[i]!
      return w0 + ((stemPerTall - r0) / (r1 - r0)) * (w1 - w0)
    }
  }
  return 900
}

/**
 * Tall height over font size until a face is matched. The tallest letters of a
 * line are its capitals or, more often, its ascenders (0.70 to 0.80 of the size
 * across the dev and goal sites' headlines, median 0.745), so a typical cap
 * height of 0.7 would read sizes about 6% large; a matched face supplies its own.
 */
export const DEFAULT_CAP_RATIO = 0.73
/** x-height over font size of a typical sans, for text with no tall letters. */
export const DEFAULT_X_RATIO = 0.52

export interface TextMetricsOptions {
  /** Image pixels per CSS pixel: 2 for a retina capture, 1024/1440 for a 1440px page sent at 1024. */
  scale?: number
  /** The matched face's tall height (capitals or ascenders) over its font size; 0.73 until a face is matched. */
  capRatio?: number
  /** The words in the box, as the finder read them: tells lower case set in capitals from text with no tall letters, and counts letters for spacing. */
  text?: string
}

export interface TextMetrics {
  ink: RGB
  frame: RGB
  /** The ink's own box, in image pixels. */
  inkBox: Box
  lines: number
  /** The first line's baseline, in image pixels. */
  baseline: number
  /** In CSS px. */
  capHeight: number
  xHeight: number
  stroke: number
  /** Baseline to baseline, in CSS px; null for one line. */
  lineHeight: number | null
  /** Line height over size, or null for one line. */
  leading: number | null
  /** Estimated letter-spacing in em; null when the words are not known. */
  letterSpacing: number | null
  /**
   * The letter-spacing is the font matcher's fit for the matched face (set
   * where the face is matched), not the estimate from the gaps between letters.
   */
  trackingFitted?: boolean
  /** Font size in CSS px. */
  size: number
  /** Estimated CSS weight, 100 to 900 (not rounded to a step). */
  weight: number
  /** Stem width over tall height, for a matcher to compare with its own drawings. */
  stemPerTall: number
  /** Set in capitals (or a face that draws lower case as capitals). */
  upper: boolean
  /** The tall-height ratio the size was read with. */
  capRatio: number
}

/** Lines of one headline share their stems within this factor. */
const STEM_AGREE = 1.5

const TALL_LETTERS = /[A-Z0-9bdfhklt]/
/** Letters as wide gaps between them: inside a word every letter but the first follows a gap. */
const letterCount = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').length
const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/**
 * Measure the text in a trimmed box. Null when the box holds no readable
 * ink (no contrast with its frame, or no line tall enough to measure).
 */
export function measureText(
  img: Image,
  box: readonly number[] | null,
  opts: TextMetricsOptions = {}
): TextMetrics | null {
  if (!box) return null
  const scale = opts.scale ?? 1
  const capRatio = opts.capRatio ?? DEFAULT_CAP_RATIO
  const c = coverage(img, [box[0]! - 1, box[1]! - 1, box[2]! + 1, box[3]! + 1])
  if (!c) return null
  const all = lineBands(c).map(([a, b]) => lineMetrics(c, a, b))
  const lines = all.filter((l) => l.right - l.left > 2 && l.tall >= 3)
  if (!lines.length) return null
  // Lines of one headline share an x-height: a line whose x-height is off by more than 12%
  // has taken in something else (art, a button's edge) and is left out of the size.
  // The anchor is the x-height most lines share; on a tie the smallest, as taking in
  // something else only ever makes a line look taller.
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.12 * b
  const support = (l: LineMetrics) => lines.filter((o) => near(o.xHeight, l.xHeight)).length
  const anchor = [...lines].sort((a, b) => support(b) - support(a) || a.xHeight - b.xHeight)[0]!
  const agree = lines.filter((l) => near(l.xHeight, anchor.xHeight))
  const use = agree.length ? agree : lines
  const xh = median(use.map((l) => l.xHeight))
  // Art or a neighbour touching a line only ever adds height: the lowest tall height among
  // lines with tall letters (well above the x-height) is the cleanest reading.
  const withTall = use.filter((l) => l.tall >= 1.2 * l.xHeight)
  const tall = withTall.length
    ? Math.min(...withTall.map((l) => l.tall))
    : median(use.map((l) => l.tall))
  const stem = median(use.map((l) => l.stem))
  const flat = xh / Math.max(1, tall) > 0.86
  const text = opts.text?.trim() ?? ''
  // No step between x-height and tall letters: capitals, unless the words have no tall letters to show.
  const noTall = text !== '' && !TALL_LETTERS.test(text)
  const upper = flat && !noTall
  const size = noTall ? xh / DEFAULT_X_RATIO / scale : tall / capRatio / scale
  // The headline's own pitch: steps between neighbouring lines of its x-height and stem,
  // never to text of another size the box takes in (an eyebrow above, a subtitle below:
  // two small lines run together can read a headline's x-height, never its stem). A stem
  // under a pixel is a failed reading (a highlighted line), not a lighter one.
  const stemsAgree = (a: number, b: number) =>
    a < 1 || b < 1 || (a <= STEM_AGREE * b && b <= STEM_AGREE * a)
  // The stem to agree with: the tallest line's (the headline's own, as smaller text is shorter).
  const tallest = [...use].filter((l) => l.stem >= 1).sort((a, b) => b.tall - a.tall)[0]
  const lineStem = tallest?.stem ?? stem
  const own = (l: LineMetrics) => use.includes(l) && stemsAgree(l.stem, lineStem)
  const steps = lines
    .slice(1)
    .flatMap((l, i) => (own(l) && own(lines[i]!) ? [l.baseline - lines[i]!.baseline] : []))
  const lineHeight = steps.length ? median(steps) / scale : null
  let letterSpacing: number | null = null
  if (text) {
    // Gaps narrower than a word space are between letters; their mean width, less the
    // sidebearings an untracked face leaves (about 0.07em), is the tracking.
    const sizeImg = size * scale
    const inner = lines.flatMap((l) => l.gaps.map(([a, b]) => b - a))
    const wordGap = 0.2 * sizeImg
    const letterGaps = inner.filter((g) => g < wordGap)
    const pairs = letterCount(text) - wordCount(text)
    if (pairs > 0) {
      const total = letterGaps.reduce((s, g) => s + g, 0)
      letterSpacing = +(total / pairs / sizeImg - 0.07).toFixed(3)
    }
  }
  const top = Math.min(...lines.map((l) => l.top))
  const bottom = Math.max(...lines.map((l) => l.bottom))
  const left = Math.min(...lines.map((l) => l.left))
  const right = Math.max(...lines.map((l) => l.right))
  return {
    ink: c.ink,
    frame: c.frame,
    inkBox: [c.box[0] + left, c.box[1] + top, c.box[0] + right, c.box[1] + bottom],
    lines: lines.length,
    baseline: c.box[1] + lines[0]!.baseline,
    capHeight: tall / scale,
    xHeight: xh / scale,
    stroke: stem / scale,
    lineHeight,
    leading: lineHeight ? +(lineHeight / size).toFixed(3) : null,
    letterSpacing,
    size,
    weight: weightFromStem(stem / Math.max(1, tall)),
    stemPerTall: stem / Math.max(1, tall),
    upper,
    capRatio,
  }
}
