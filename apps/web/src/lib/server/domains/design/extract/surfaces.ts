/**
 * A region's colours with shares, read tile by tile. Tiles are flat (one
 * colour), text (one colour plus blends toward a second), gradient (smooth
 * drift with no plateau) or photo (busy texture), told apart by local
 * variance, so photo and gradient colours are flagged and never count as
 * brand colours.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { hex } from './color'
import { binKey, clampBox, dist3, labDist, labImage, type Swatch } from './colours'
import type { Box } from './kinds'
import type { Image } from './png'

export const TILE_KINDS = ['flat', 'text', 'gradient', 'photo'] as const
export type TileKind = (typeof TILE_KINDS)[number]

export interface SurfaceMap {
  box: Box
  /** Tile edge in pixels. */
  size: number
  cols: number
  rows: number
  /** Index into TILE_KINDS per tile. */
  kind: Uint8Array
  /** Each tile's main colour, OKLab (3 per tile) and RGB (3 per tile). */
  lab: Float32Array
  rgb: Float32Array
  /** Share of the tile its main colour holds. */
  main: Float32Array
  /** A text tile's ink colour, OKLab and RGB, and its share of the tile. */
  inkLab: Float32Array
  inkRgb: Float32Array
  ink: Float32Array
}

const FLAT = 0
const TEXT = 1
const GRADIENT = 2
const PHOTO = 3

/**
 * Tiles of a region classified by local variance: flat (one colour), text
 * (one colour plus the blends toward a second, as type and icons draw),
 * gradient (smooth, but drifting with no plateau) or photo (busy texture).
 * `size` is the tile edge in pixels (8 at CSS scale).
 */
export function surfaceMap(img: Image, box?: readonly number[] | null, size = 8): SurfaceMap {
  const b = clampBox(box ?? [0, 0, img.width, img.height], img)
  const L = labImage(img)
  const W = img.width
  const cols = Math.max(0, Math.floor((b[2] - b[0]) / size))
  const rows = Math.max(0, Math.floor((b[3] - b[1]) / size))
  const nT = cols * rows
  const map: SurfaceMap = {
    box: b,
    size,
    cols,
    rows,
    kind: new Uint8Array(nT),
    lab: new Float32Array(nT * 3),
    rgb: new Float32Array(nT * 3),
    main: new Float32Array(nT),
    inkLab: new Float32Array(nT * 3),
    inkRgb: new Float32Array(nT * 3),
    ink: new Float32Array(nT),
  }
  const idx = new Int32Array(size * size)
  const smooth = new Float32Array(nT)
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const t = ty * cols + tx
      const x0 = b[0] + tx * size
      const y0 = b[1] + ty * size
      let k = 0
      for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) idx[k++] = y * W + x
      // Main colour: the fullest quantised bin, then the mean of pixels near it.
      const bins = new Map<number, number>()
      let mode = idx[0]!
      let modeN = 0
      for (let j = 0; j < k; j++) {
        const i = idx[j]!
        const key = binKey(L[i * 3]!, L[i * 3 + 1]!, L[i * 3 + 2]!)
        const v = (bins.get(key) ?? 0) + 1
        bins.set(key, v)
        if (v > modeN) {
          modeN = v
          mode = i
        }
      }
      let n = 0
      const c = [0, 0, 0, 0, 0, 0]
      for (let j = 0; j < k; j++) {
        const i = idx[j]!
        if (dist3(L, i * 3, L, mode * 3) < 0.03) {
          n++
          c[0] += L[i * 3]!
          c[1] += L[i * 3 + 1]!
          c[2] += L[i * 3 + 2]!
          c[3] += img.data[i * 4]!
          c[4] += img.data[i * 4 + 1]!
          c[5] += img.data[i * 4 + 2]!
        }
      }
      for (let q = 0; q < 3; q++) {
        map.lab[t * 3 + q] = c[q]! / n
        map.rgb[t * 3 + q] = c[q + 3]! / n
      }
      const share = n / k
      map.main[t] = share
      // Mean step between neighbouring pixels: tiny for a gradient, large for a photo.
      let step = 0
      let steps = 0
      for (let y = y0; y < y0 + size - 1; y++) {
        for (let x = x0; x < x0 + size - 1; x++) {
          const i = y * W + x
          step += dist3(L, i * 3, L, (i + 1) * 3) + dist3(L, i * 3, L, (i + W) * 3)
          steps += 2
        }
      }
      smooth[t] = step / Math.max(1, steps)
      if (share >= 0.85) {
        map.kind[t] = FLAT
        continue
      }
      // Text: the rest lies on the line from the main colour to one far colour.
      let far = -1
      let fd = 0
      for (let j = 0; j < k; j++) {
        const d = Math.hypot(
          L[idx[j]! * 3]! - map.lab[t * 3]!,
          L[idx[j]! * 3 + 1]! - map.lab[t * 3 + 1]!,
          L[idx[j]! * 3 + 2]! - map.lab[t * 3 + 2]!
        )
        if (d > fd) {
          fd = d
          far = idx[j]!
        }
      }
      let onLine = 0
      let rest = 0
      const ink = [0, 0, 0, 0, 0, 0]
      let inkN = 0
      const m0 = map.lab[t * 3]!
      const m1 = map.lab[t * 3 + 1]!
      const m2 = map.lab[t * 3 + 2]!
      const e0 = L[far * 3]! - m0
      const e1 = L[far * 3 + 1]! - m1
      const e2 = L[far * 3 + 2]! - m2
      const len2 = e0 * e0 + e1 * e1 + e2 * e2
      for (let j = 0; j < k; j++) {
        const i = idx[j]!
        const p0 = L[i * 3]! - m0
        const p1 = L[i * 3 + 1]! - m1
        const p2 = L[i * 3 + 2]! - m2
        if (Math.hypot(p0, p1, p2) < 0.03) continue
        rest++
        const u = len2 > 0 ? (p0 * e0 + p1 * e1 + p2 * e2) / len2 : 0
        const off = Math.hypot(p0 - u * e0, p1 - u * e1, p2 - u * e2)
        if (off < 0.035) onLine++
        if (
          Math.hypot(
            L[i * 3]! - L[far * 3]!,
            L[i * 3 + 1]! - L[far * 3 + 1]!,
            L[i * 3 + 2]! - L[far * 3 + 2]!
          ) < 0.05
        ) {
          inkN++
          ink[0] += L[i * 3]!
          ink[1] += L[i * 3 + 1]!
          ink[2] += L[i * 3 + 2]!
          ink[3] += img.data[i * 4]!
          ink[4] += img.data[i * 4 + 1]!
          ink[5] += img.data[i * 4 + 2]!
        }
      }
      if (share >= 0.25 && fd > 0.1 && onLine >= 0.85 * rest) {
        map.kind[t] = TEXT
        for (let q = 0; q < 3; q++) {
          map.inkLab[t * 3 + q] = ink[q]! / Math.max(1, inkN)
          map.inkRgb[t * 3 + q] = ink[q + 3]! / Math.max(1, inkN)
        }
        map.ink[t] = inkN / k
        continue
      }
      map.kind[t] = smooth[t]! < 0.012 ? GRADIENT : PHOTO
    }
  }
  // A flat tile whose neighbours on both sides along a line differ a little (a drift, no plateau) is part of a gradient.
  const drift = new Uint8Array(nT)
  const smoothNeighbour = (t: number, nx: number, ny: number) => {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false
    const u = ny * cols + nx
    if (map.kind[u] !== FLAT && map.kind[u] !== GRADIENT) return false
    const d = dist3(map.lab, t * 3, map.lab, u * 3)
    return d >= 0.004 && d < 0.08
  }
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const t = ty * cols + tx
      if (map.kind[t] !== FLAT) continue
      if (
        (smoothNeighbour(t, tx - 1, ty) && smoothNeighbour(t, tx + 1, ty)) ||
        (smoothNeighbour(t, tx, ty - 1) && smoothNeighbour(t, tx, ty + 1))
      )
        drift[t] = 1
    }
  }
  for (let t = 0; t < nT; t++) if (drift[t]) map.kind[t] = GRADIENT
  // A lone flat tile inside a photo (sky, a wall) is the photo's.
  const flip: number[] = []
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const t = ty * cols + tx
      if (map.kind[t] === PHOTO || map.kind[t] === GRADIENT) continue
      let busy = 0
      let all = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = tx + dx
          const ny = ty + dy
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
          all++
          if (map.kind[ny * cols + nx] === PHOTO) busy++
        }
      if (all && busy >= 6) flip.push(t)
    }
  }
  for (const t of flip) map.kind[t] = PHOTO
  return map
}

/** A colour this saturated (OKLab chroma) is vivid: a brand's sweep, not a pale wash. */
export const VIVID = 0.1

export interface Sweep {
  /** Per tile: 0 none, 1 a tile in a smooth colour drift, 2 one in a vivid colour. */
  tile: Uint8Array
  /** Shares of the region in drift, and in vivid drift. */
  share: number
  vivid: number
}

/**
 * Where a region's colour drifts smoothly, at any scale. A gradient over a
 * wide hero changes too little from one tile to the next for the tile test
 * (each tile looks flat), so a flat tile counts when the tiles a stride away
 * on both sides (2, 4 or 8 tiles) differ from it by similar amounts, in one
 * direction, and the change goes on inside the stride: a drift, not a plateau
 * by a boundary nor three flat shapes in a row. Vivid drift then spreads to
 * the region's edges, where a stride runs out. Leaves the tile kinds alone.
 */
export function sweepOf(map: SurfaceMap): Sweep {
  const { cols, rows, kind, lab } = map
  const n = cols * rows
  const tile = new Uint8Array(n)
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= cols || y >= rows ? -1 : y * cols + x
  const smooth = (u: number) => u >= 0 && (kind[u] === FLAT || kind[u] === GRADIENT)
  const d = (a: number, b: number) => dist3(lab, a * 3, lab, b * 3)
  const chroma = (t: number) => Math.hypot(lab[t * 3 + 1]!, lab[t * 3 + 2]!)
  const drifts = (t: number, tx: number, ty: number, dx: number, dy: number) => {
    for (const s of [2, 4, 8]) {
      const a = at(tx - dx * s, ty - dy * s)
      const b = at(tx + dx * s, ty + dy * s)
      if (a < 0 || b < 0) return false
      if (!smooth(a) || !smooth(b)) continue
      const d1 = d(a, t)
      const d2 = d(t, b)
      // Too little change at this stride: try a longer one.
      if (d1 < 0.008 || d2 < 0.008) continue
      const most = Math.max(d1, d2)
      if (most > 0.25 || Math.min(d1, d2) < 0.35 * most || d(a, b) < 0.9 * (d1 + d2)) return false
      const h = s / 2
      const p = at(tx - dx * h, ty - dy * h)
      const q = at(tx + dx * h, ty + dy * h)
      return smooth(p) && smooth(q) && d(p, t) >= 0.25 * d1 && d(t, q) >= 0.25 * d2
    }
    return false
  }
  for (let ty = 0; ty < rows; ty++)
    for (let tx = 0; tx < cols; tx++) {
      const t = ty * cols + tx
      if (
        kind[t] === GRADIENT ||
        (kind[t] === FLAT && (drifts(t, tx, ty, 1, 0) || drifts(t, tx, ty, 0, 1)))
      )
        tile[t] = chroma(t) >= VIVID ? 2 : 1
    }
  // Vivid drift reaches the edges a stride cannot: a vivid smooth tile beside vivid drift of a near colour.
  for (let pass = 0; pass < 8; pass++) {
    const grow: number[] = []
    for (let ty = 0; ty < rows; ty++)
      for (let tx = 0; tx < cols; tx++) {
        const t = ty * cols + tx
        if (tile[t] === 2 || !smooth(t) || chroma(t) < VIVID) continue
        let near = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const u = at(tx + dx, ty + dy)
            if (u >= 0 && u !== t && tile[u] === 2 && d(u, t) < 0.03) near++
          }
        if (near >= 3) grow.push(t)
      }
    if (!grow.length) break
    for (const t of grow) tile[t] = 2
  }
  let any = 0
  let vivid = 0
  for (let t = 0; t < n; t++) {
    if (tile[t]) any++
    if (tile[t] === 2) vivid++
  }
  return { tile, share: n ? any / n : 0, vivid: n ? vivid / n : 0 }
}

export interface RegionPalette {
  /** Colours of the flat and text tiles, with shares of the whole region, largest first. */
  colours: Swatch[]
  /** Shares of the region in photo and gradient tiles. */
  photo: number
  gradient: number
  /** The region reads as a photo or a gradient: its colours are not brand colours. */
  isPhoto: boolean
  isGradient: boolean
  /** Colours of the gradient tiles (for a gradient band), largest first, never brand evidence on their own. */
  gradientColours: Swatch[]
}

interface Acc {
  lab: [number, number, number]
  rgb: [number, number, number]
  w: number
}

/** Weighted colours merged greedily: each joins the first group within `apart` in OKLab. */
export function mergeColours(
  items: { lab: readonly number[]; rgb: readonly number[]; w: number }[],
  apart = 0.04
): Acc[] {
  const groups: Acc[] = []
  for (const it of [...items].sort((a, b) => b.w - a.w)) {
    if (it.w <= 0) continue
    const g = groups.find((x) => labDist(x.lab, it.lab) < apart)
    if (!g) {
      groups.push({
        lab: [it.lab[0]!, it.lab[1]!, it.lab[2]!],
        rgb: [it.rgb[0]!, it.rgb[1]!, it.rgb[2]!],
        w: it.w,
      })
      continue
    }
    const t = g.w + it.w
    for (let q = 0; q < 3; q++) {
      g.lab[q] = (g.lab[q]! * g.w + it.lab[q]! * it.w) / t
      g.rgb[q] = (g.rgb[q]! * g.w + it.rgb[q]! * it.w) / t
    }
    g.w = t
  }
  return groups.sort((a, b) => b.w - a.w)
}

const accSwatch = (g: Acc, total: number): Swatch => ({
  hex: hex(g.rgb),
  rgb: [Math.round(g.rgb[0]), Math.round(g.rgb[1]), Math.round(g.rgb[2])],
  lab: g.lab,
  share: total ? g.w / total : 0,
})

/** The colours of a map's tiles (or those passing `keep`), weighted by pixels. */
export function mapColours(
  map: SurfaceMap,
  keep: (t: number, kind: TileKind) => boolean = () => true
): { colours: Swatch[]; gradientColours: Swatch[]; photo: number; gradient: number } {
  const items: { lab: number[]; rgb: number[]; w: number }[] = []
  const grads: { lab: number[]; rgb: number[]; w: number }[] = []
  const px = map.size * map.size
  let total = 0
  let photo = 0
  let gradient = 0
  for (let t = 0; t < map.kind.length; t++) {
    const kind = TILE_KINDS[map.kind[t]!]!
    if (!keep(t, kind)) continue
    total += px
    const lab = [map.lab[t * 3]!, map.lab[t * 3 + 1]!, map.lab[t * 3 + 2]!]
    const rgb = [map.rgb[t * 3]!, map.rgb[t * 3 + 1]!, map.rgb[t * 3 + 2]!]
    if (kind === 'photo') photo += px
    else if (kind === 'gradient') {
      gradient += px
      grads.push({ lab, rgb, w: px })
    } else {
      items.push({ lab, rgb, w: px * map.main[t]! })
      if (kind === 'text')
        items.push({
          lab: [map.inkLab[t * 3]!, map.inkLab[t * 3 + 1]!, map.inkLab[t * 3 + 2]!],
          rgb: [map.inkRgb[t * 3]!, map.inkRgb[t * 3 + 1]!, map.inkRgb[t * 3 + 2]!],
          w: px * map.ink[t]!,
        })
    }
  }
  return {
    colours: mergeColours(items)
      .map((g) => accSwatch(g, total))
      .filter((c) => c.share >= 0.003),
    gradientColours: mergeColours(grads, 0.05)
      .map((g) => accSwatch(g, total))
      .filter((c) => c.share >= 0.01),
    photo: total ? photo / total : 0,
    gradient: total ? gradient / total : 0,
  }
}

/**
 * A region's colours with shares. Photo and gradient tiles are left out of
 * the colours and reported as shares; a region mostly photo or gradient is
 * flagged, so its colours are never taken for brand colours.
 */
export function regionPalette(img: Image, box: readonly number[] | null, size = 8): RegionPalette {
  const b = box ? clampBox(box, img) : null
  if (!b || b[2] - b[0] < size || b[3] - b[1] < size)
    return {
      colours: [],
      photo: 0,
      gradient: 0,
      isPhoto: false,
      isGradient: false,
      gradientColours: [],
    }
  const map = surfaceMap(img, b, size)
  const r = mapColours(map)
  return {
    ...r,
    isPhoto: r.photo >= 0.35,
    isGradient: r.gradient >= 0.3 && r.photo < 0.35,
  }
}
