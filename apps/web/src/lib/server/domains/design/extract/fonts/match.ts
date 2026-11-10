/**
 * Font matching: measure a text crop, then draw its text in each bundled
 * face and weight, measure the drawing the same way, and rank faces by how
 * closely they agree (x-height ratio, stem weight, stroke contrast, width,
 * row profile), then by the ink overlap of each word after aligning
 * baselines and left edges (stage 2, top faces only).
 *
 * Ported from the T4 spike (server renderer: headline size within 10% 94 to
 * 100%, weight within 100 85 to 90%, exact family with Inter and Inter Tight
 * as one 100% on the faces we bundle; about 0.3 to 0.5s a text crop).
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { Image } from '../png'
import { FACES, nearestWeight, type Face } from './faces'
import {
  inkMask,
  lineMetrics,
  textMetrics,
  type LineMetrics,
  type Mask,
  type TextMetrics,
} from './metrics'
import { assignLines, gapWordCount, textWords } from './lines'
import type { Renderer, Rendered } from './woff'

/** Canonical working scale: lines are resampled so their tall height is at most this (px). */
const CANON_TALL = 44

export function resample(m: Mask, f: number): Mask {
  if (f <= 1.0001) return m
  const w = Math.max(1, Math.round(m.w / f)),
    h = Math.max(1, Math.round(m.h / f))
  const a = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx0 = x * f,
        sx1 = (x + 1) * f,
        sy0 = y * f,
        sy1 = (y + 1) * f
      let s = 0,
        n = 0
      for (let yy = Math.floor(sy0); yy < Math.min(m.h, Math.ceil(sy1)); yy++) {
        const wy = Math.min(sy1, yy + 1) - Math.max(sy0, yy)
        for (let xx = Math.floor(sx0); xx < Math.min(m.w, Math.ceil(sx1)); xx++) {
          const wx = Math.min(sx1, xx + 1) - Math.max(sx0, xx)
          s += m.a[yy * m.w + xx]! * wx * wy
          n += wx * wy
        }
      }
      a[y * w + x] = n ? s / n : 0
    }
  return { w, h, a }
}

export interface MLine {
  lm: LineMetrics
  text: string
  words: number
}
export interface Measured {
  mask: Mask // at working scale
  scale: number // working px per image px
  dpr: number
  tm: TextMetrics
  lines: MLine[] // complete lines with known text
  upper: boolean
  /** Face-agnostic estimates (CSS px, CSS weight). */
  sizeTypical: number
  weightPixel: number
  stemPerTall: number
  xRatio: number
  contrast: number
  ms: number
}

/**
 * Stem over tall height to CSS weight, measured once on ten bundled text sans
 * faces drawn by this renderer at 20, 40 and 64px (the spike's calibrate.ts,
 * median per weight).
 */
export const WEIGHT_CALIB: ReadonlyArray<readonly [number, number]> = [
  [0.0598, 200],
  [0.0811, 300],
  [0.1162, 400],
  [0.1441, 500],
  [0.1739, 600],
  [0.2015, 700],
  [0.2312, 800],
  [0.264, 900],
]
export function weightFromStem(r: number): number {
  const c = WEIGHT_CALIB
  if (r <= c[0]![0]) return c[0]![1]
  for (let i = 1; i < c.length; i++)
    if (r <= c[i]![0]) {
      const [r0, w0] = c[i - 1]!,
        [r1, w1] = c[i]!
      return w0 + ((r - r0) / (r1 - r0)) * (w1 - w0)
    }
  return c[c.length - 1]![1]
}

export function measure(
  img: Image,
  box: number[],
  text: string,
  dpr: number,
  /** The length at which the text may have been cut short (the spike's truth text was cut at 80). */
  cut = 80,
  /**
   * Another reading of a box no face drew: lines parted at a higher floor
   * (lineBands), and lines that may hold only the text's first words.
   */
  reading: { floor?: number; firstLines?: boolean } = {}
): Measured {
  const t0 = performance.now()
  const ink = inkMask(img, box, 3 * dpr, dpr)
  const pre = textMetrics(ink.mask, undefined, reading.floor)
  const f = Math.max(1, pre.tall / CANON_TALL)
  const mask = resample(ink.mask, f)
  const tm = f > 1 ? textMetrics(mask, undefined, reading.floor) : pre
  const { words, truncated } = textWords(text, cut)
  const sizeW = tm.tall / 0.72
  const asg = assignLines(
    tm.lines.map((l) => l.width),
    tm.upperLike ? words.map((w) => w.toUpperCase()) : words,
    sizeW,
    truncated,
    tm.lines.map((l) => gapWordCount(l.gaps, l.tall)),
    reading.firstLines
  )
  const lines: MLine[] = []
  if (asg)
    tm.lines.forEach((lm, i) => {
      if (asg.complete[i] && asg.lines[i])
        lines.push({ lm, text: asg.lines[i]!, words: asg.lines[i]!.split(' ').length })
    })
  const stemPerTall = tm.stem / tm.tall
  return {
    mask,
    scale: 1 / f,
    dpr,
    tm,
    lines,
    upper: tm.upperLike,
    sizeTypical: (tm.tall * f) / 0.72 / dpr,
    weightPixel: weightFromStem(stemPerTall),
    stemPerTall,
    xRatio: tm.xHeight / tm.tall,
    contrast: tm.hstroke / Math.max(0.1, tm.stem),
    ms: performance.now() - t0,
  }
}

export interface Candidate {
  face: Face
  weight: number
  /** CSS px size that makes this face's tall height match. */
  size: number
  /** Letter-spacing (em) that makes this face's line widths match. */
  tracking: number
  eX: number
  eS: number
  eC: number
  eW: number
  eP: number
  d1: number // stage-1 distance
  /** Each line's own fit (working px), so one odd line cannot skew another's rendering. */
  perLine?: Array<{ size: number; trackingPx: number } | null>
  iou?: number
  score: number // lower is better
}

const rowProfile = (m: Mask, top: number, bottom: number) => {
  const p = new Float32Array(bottom - top)
  let s = 0
  for (let y = top; y < bottom; y++) {
    let r = 0
    for (let x = 0; x < m.w; x++) r += m.a[y * m.w + x]!
    p[y - top] = r
    s += r
  }
  for (let i = 0; i < p.length; i++) p[i]! /= s || 1
  return p
}

/** L1 distance of two row profiles, the render's scaled by k and aligned on baselines. */
function profileDist(
  pm: Float32Array,
  baseM: number,
  pr: Float32Array,
  baseR: number,
  k: number
): number {
  let d = 0
  const lo = Math.min(-baseM, -baseR * k),
    hi = Math.max(pm.length - baseM, (pr.length - baseR) * k)
  const at = (p: Float32Array, y: number) => {
    const i = Math.floor(y),
      t = y - i
    const a = p[i] ?? 0,
      b = p[i + 1] ?? 0
    return (i >= 0 && i < p.length ? a : 0) * (1 - t) + (i + 1 >= 0 && i + 1 < p.length ? b : 0) * t
  }
  for (let y = Math.floor(lo); y <= Math.ceil(hi); y++)
    d += Math.abs(at(pm, y + baseM) - at(pr, y / k + baseR) / k)
  return d
}

/** Vertical scale (and sub-pixel baseline offset) that best lays the render's row profile on the measured one. */
function fitScale(
  pm: Float32Array,
  baseM: number,
  pr: Float32Array,
  baseR: number,
  k0: number
): { k: number; d: number } {
  let best = { k: k0, d: profileDist(pm, baseM, pr, baseR, k0) }
  for (let f = 0.9; f <= 1.1001; f += 0.01)
    for (let o = -1; o <= 1; o += 0.25) {
      const d = profileDist(pm, baseM + o, pr, baseR, k0 * f)
      if (d < best.d) best = { k: k0 * f, d }
    }
  const k1 = best.k
  for (let f = 0.99; f <= 1.0101; f += 0.0025)
    for (let o = -1; o <= 1; o += 0.125) {
      const d = profileDist(pm, baseM + o, pr, baseR, k1 * f)
      if (d < best.d) best = { k: k1 * f, d }
    }
  return best
}

interface LineFeat {
  lm: LineMetrics
  prof: Float32Array
  base: number
}
const lineFeat = (m: Mask): LineFeat | null => {
  const tm = textMetrics(m)
  const lm = tm.lines.reduce<LineMetrics | null>((b, l) => (!b || l.ink > b.ink ? l : b), null)
  if (!lm) return null
  return { lm, prof: rowProfile(m, lm.top, lm.bottom), base: lm.baseline - lm.top }
}

const SIG = { eX: 0.035, eS: 0.07, eC: 0.2, eW: 0.07, eP: 0.12, iou: 0.05 }

export interface MatchOptions {
  faces?: Face[]
  weightsPerFace?: number
  weightSpan?: number
  stage2?: boolean
}

export interface FaceMatch {
  /** Faces best first, each at its best weight. */
  ranked: Candidate[]
  renders: number
  ms: number
  /** The letter-spacing a typical face would need, em. */
  trackingTypical: number
  /** Every face and weight as stage 1 fitted it, each weight's size and spacing (unordered). */
  fitted: Candidate[]
}

/** The complete lines a match draws, at most. */
export const MATCHED_LINES = 3

export function matchFaces(r: Renderer, M: Measured, opts: MatchOptions = {}): FaceMatch {
  const t0 = performance.now()
  const faces = opts.faces ?? FACES
  const lines = M.lines.slice(0, MATCHED_LINES)
  if (!lines.length) return { ranked: [], renders: 0, ms: 0, trackingTypical: 0, fitted: [] }
  const mLines = lines.map((l) => ({
    ...l,
    prof: rowProfile(M.mask, l.lm.top, l.lm.bottom),
    base: l.lm.baseline - l.lm.top,
  }))
  const totalW = lines.reduce((s, l) => s + l.lm.width, 0)
  // Render at the working scale's size so anti-aliasing compares.
  const S = M.tm.tall / 0.72
  const span = opts.weightSpan ?? 250
  const jobs: Array<{ face: Face; weight: number }> = []
  for (const face of faces) {
    const ws = face.weights.filter((w) => Math.abs(w - M.weightPixel) <= span)
    for (const w of ws.length ? ws : [nearestWeight(face.weights, M.weightPixel)])
      jobs.push({ face, weight: w })
  }
  const reqs = jobs.flatMap((j) =>
    lines.map((l) => ({ face: j.face, weight: j.weight, size: S, text: l.text }))
  )
  const out = r.render(reqs)
  let renders = reqs.length
  // Per line and job: features and a stage-1 distance.
  type LF = {
    eX: number
    eS: number
    eC: number
    eW: number
    eP: number
    k: number
    tr: number
    d1: number
  }
  const feats: Array<Array<LF | null>> = jobs.map((_, ji) =>
    lines.map((l, li) => {
      const rf = lineFeat(out[ji * lines.length + li]!.mask)
      if (!rf) return null
      const m = l.lm,
        q = rf.lm
      const fit = fitScale(mLines[li]!.prof, mLines[li]!.base, rf.prof, rf.base, m.tall / q.tall)
      const k = fit.k
      const f = {
        eX: Math.log(m.xHeight / m.tall / (q.xHeight / q.tall)),
        eS: Math.log(m.stem / m.tall / (q.stem / q.tall)),
        eC: Math.log(m.hstroke / Math.max(0.2, m.stem) / (q.hstroke / Math.max(0.2, q.stem))),
        eW: Math.log(m.inkCols / (q.inkCols * k)),
        eP: fit.d,
        k,
        tr: (m.width - q.width * k) / (Math.max(1, [...l.text].length - 1) * S * k),
        d1: 0,
      }
      f.d1 =
        (f.eX / SIG.eX) ** 2 +
        (f.eS / SIG.eS) ** 2 +
        (f.eC / SIG.eC) ** 2 +
        (f.eW / SIG.eW) ** 2 +
        (f.eP / SIG.eP) ** 2
      return f
    })
  )
  // Line weights: width, discounted where no face fits (an accent word in another style, a photo behind).
  const bestD = lines.map((_, li) => Math.min(...feats.map((fs) => fs[li]?.d1 ?? Infinity)))
  const lw = lines.map((l, li) => l.lm.width / totalW / (1 + bestD[li]!))
  const cands: Candidate[] = []
  jobs.forEach((j, ji) => {
    const acc = { eX: 0, eS: 0, eC: 0, eW: 0, eP: 0, k: 0, tr: 0, d1: 0 }
    let n = 0
    feats[ji]!.forEach((f, li) => {
      if (!f) return
      for (const key of Object.keys(acc) as Array<keyof LF>) acc[key] += lw[li]! * f[key]
      n += lw[li]!
    })
    if (!n) return
    for (const key of Object.keys(acc) as Array<keyof LF>) acc[key] /= n
    cands.push({
      face: j.face,
      weight: j.weight,
      size: (S * acc.k) / M.scale / M.dpr,
      tracking: acc.tr,
      eX: acc.eX,
      eS: acc.eS,
      eC: acc.eC,
      eW: acc.eW,
      eP: acc.eP,
      d1: acc.d1,
      score: acc.d1,
      perLine: feats[ji]!.map((f) => (f ? { size: S * f.k, trackingPx: f.tr * S * f.k } : null)),
    })
  })
  // Each face keeps its two best weights for stage 2 (the best one alone without it).
  const byFace = new Map<string, Candidate[]>()
  for (const c of cands) {
    // Tracking beyond ±0.05em is rare: such a face is the wrong width.
    c.d1 += (Math.max(0, Math.abs(c.tracking) - 0.05) / 0.02) ** 2 + (c.tracking / 0.04) ** 2
    byFace.set(c.face.id, [...(byFace.get(c.face.id) ?? []), c])
  }
  for (const cs of byFace.values()) cs.sort((a, b) => a.d1 - b.d1)
  let best: Candidate[] = [...byFace.values()].map((cs) => cs[0]!)
  best.sort((a, b) => a.d1 - b.d1)
  if (opts.stage2 !== false) {
    const pool = [...byFace.values()].flatMap((cs) => cs.slice(0, opts.weightsPerFace ?? 2))
    const reqs2 = pool.flatMap((c) =>
      lines.map((l, li) => {
        const pl = c.perLine?.[li]
        return {
          face: c.face,
          weight: c.weight,
          size: pl?.size ?? c.size * M.scale * M.dpr,
          text: l.text,
          trackingPx: pl?.trackingPx ?? c.tracking * c.size * M.scale * M.dpr,
        }
      })
    )
    const out2 = r.render(reqs2)
    renders += reqs2.length
    const ious = pool.map((_, ci) =>
      lines.map((l, li) => wordIoU(M.mask, l, out2[ci * lines.length + li]!))
    )
    const bestI = lines.map((_, li) => Math.max(...ious.map((x) => x[li]!)))
    const iw = lines.map((l, li) => l.lm.width * bestI[li]! ** 2)
    pool.forEach((c, ci) => {
      let s = 0,
        n = 0
      lines.forEach((_, li) => {
        s += iw[li]! * ious[ci]![li]!
        n += iw[li]!
      })
      c.iou = n ? s / n : 0
      c.score = c.d1 + ((1 - c.iou) / SIG.iou) ** 2
    })
    pool.sort((a, b) => a.score - b.score)
    const seen = new Set<string>()
    best = pool.filter((c) => (seen.has(c.face.id) ? false : (seen.add(c.face.id), true)))
  }
  // Tracking against a typical face: the median of what each face would need.
  const trs = best.map((c) => c.tracking).sort((a, b) => a - b)
  const trackingTypical = trs[Math.floor(trs.length / 2)] ?? 0
  return { ranked: best, renders, ms: performance.now() - t0, trackingTypical, fitted: cands }
}

/** Soft IoU of a measured line and its rendering, each word aligned on its left edge and the baseline. */
export function wordIoU(M: Mask, l: MLine, R: Rendered): number {
  const rt = textMetrics(R.mask)
  const q = rt.lines.reduce<LineMetrics | null>((b, x) => (!b || x.ink > b.ink ? x : b), null)
  if (!q) return 0
  const m = l.lm
  const seg = (lm: LineMetrics) => {
    const gaps = [...lm.gaps]
      .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
      .slice(0, l.words - 1)
      .sort((a, b) => a[0] - b[0])
    const xs: Array<[number, number]> = []
    let s = lm.left
    for (const g of gaps) {
      xs.push([s, g[0]])
      s = g[1]
    }
    xs.push([s, lm.right])
    return xs
  }
  const ws = seg(m),
    wr = seg(q)
  if (ws.length !== wr.length) return 0
  const smp = (k: Mask, x: number, y: number) =>
    x >= 0 && x < k.w && y >= 0 && y < k.h ? k.a[y * k.w + x]! : 0
  let inter = 0,
    uni = 0
  for (let i = 0; i < ws.length; i++) {
    const [a, b] = ws[i]!,
      [ar] = wr[i]!
    const wEnd = Math.max(b, a + (wr[i]![1] - ar))
    for (let y = m.top; y < m.bottom; y++) {
      const yr = y - m.baseline + q.baseline
      for (let x = a; x < wEnd; x++) {
        const mv = smp(M, x, y)
        const rv = smp(R.mask, x - a + ar, yr)
        inter += Math.min(mv, rv)
        uni += Math.max(mv, rv)
      }
    }
  }
  return uni ? inter / uni : 0
}

export { lineMetrics }
