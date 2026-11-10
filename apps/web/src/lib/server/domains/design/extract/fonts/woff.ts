/**
 * Text drawn in a bundled face on the server: pure TypeScript, no browser,
 * no native dependency. Reads a face's WOFF file (zlib via node:zlib), its
 * glyph outlines (TrueType glyf, or CFF for Geist), advances (hmtx) and pair
 * kerning (GPOS PairPos), lays out a line and fills it with an exact-area
 * anti-aliased rasterizer (the accumulation method of font-rs).
 *
 * Ported from the T4 font matching spike, where it matched the browser's
 * canvas on the dataset (family, size and weight) at about 0.5s a headline.
 */
import { cffFont } from './cff'
import { glyfOutline, parseCmap, woffTables, type Path, type Pt } from './sfnt'
import type { Face } from './faces'
import { readFontFile } from './files'
import type { Mask } from './metrics'

/** A line of text to draw: the face and weight, the size in px, and extra space between letters. */
export interface RenderReq {
  face: Face
  weight: number
  size: number
  text: string
  trackingPx?: number
}

/** A drawn line: its coverage mask, its baseline row and its advance. */
export interface Rendered {
  mask: Mask
  baseline: number
  advance: number
}

/** Draws lines of text; the matcher measures what it draws as it measures a screenshot. */
export interface Renderer {
  name: string
  render(reqs: RenderReq[]): Rendered[]
}

export interface Font {
  upm: number
  ascender: number
  descender: number
  cmap: Map<number, number>
  advance: (g: number) => number
  outline: (g: number) => Path
  kern: (a: number, b: number) => number
}

// ---------- GPOS pair kerning ----------
function gposKern(t: DataView | undefined): (a: number, b: number) => number {
  type Sub =
    | { pairs: Map<number, number> }
    | { cov: Set<number>; c1: Map<number, number>; c2: Map<number, number>; vals: number[][] }
  const lookupsSubs: Sub[][] = []
  if (!t) return () => 0
  const coverage = (o: number): number[] => {
    const f = t.getUint16(o),
      out: number[] = []
    if (f === 1) {
      const n = t.getUint16(o + 2)
      for (let i = 0; i < n; i++) out.push(t.getUint16(o + 4 + i * 2))
    } else {
      const n = t.getUint16(o + 2)
      for (let i = 0; i < n; i++) {
        const s = t.getUint16(o + 4 + i * 6),
          e = t.getUint16(o + 6 + i * 6)
        for (let g = s; g <= e; g++) out.push(g)
      }
    }
    return out
  }
  const classDef = (o: number): Map<number, number> => {
    const m = new Map<number, number>(),
      f = t.getUint16(o)
    if (f === 1) {
      const s = t.getUint16(o + 2),
        n = t.getUint16(o + 4)
      for (let i = 0; i < n; i++) m.set(s + i, t.getUint16(o + 6 + i * 2))
    } else {
      const n = t.getUint16(o + 2)
      for (let i = 0; i < n; i++) {
        const s = t.getUint16(o + 4 + i * 6),
          e = t.getUint16(o + 6 + i * 6),
          c = t.getUint16(o + 8 + i * 6)
        for (let g = s; g <= e; g++) m.set(g, c)
      }
    }
    return m
  }
  const vsize = (f: number) => {
    let n = 0
    for (let b = 0; b < 8; b++) if (f & (1 << b)) n++
    return n * 2
  }
  const xadv = (o: number, f: number) => {
    if (!(f & 4)) return 0
    let off = 0
    if (f & 1) off += 2
    if (f & 2) off += 2
    return t.getInt16(o + off)
  }
  const featureList = t.getUint16(6),
    lookupList = t.getUint16(8)
  const lookups = new Set<number>()
  const nf = t.getUint16(featureList)
  for (let i = 0; i < nf; i++) {
    const tag = String.fromCharCode(
      t.getUint8(featureList + 2 + i * 6),
      t.getUint8(featureList + 3 + i * 6),
      t.getUint8(featureList + 4 + i * 6),
      t.getUint8(featureList + 5 + i * 6)
    )
    if (tag !== 'kern') continue
    const fo = featureList + t.getUint16(featureList + 6 + i * 6)
    const n = t.getUint16(fo + 2)
    for (let j = 0; j < n; j++) lookups.add(t.getUint16(fo + 4 + j * 2))
  }
  for (const li of lookups) {
    const lo = lookupList + t.getUint16(lookupList + 2 + li * 2)
    const type = t.getUint16(lo)
    const n = t.getUint16(lo + 4)
    const subs: Sub[] = []
    lookupsSubs.push(subs)
    for (let s = 0; s < n; s++) {
      let so = lo + t.getUint16(lo + 6 + s * 2)
      if (type === 9) {
        const et = t.getUint16(so + 2)
        so = so + t.getUint32(so + 4)
        if (et !== 2) continue
      } else if (type !== 2) continue
      const fmt = t.getUint16(so),
        cov = coverage(so + t.getUint16(so + 2)),
        f1 = t.getUint16(so + 4),
        f2 = t.getUint16(so + 6)
      if (fmt === 1) {
        const nset = t.getUint16(so + 8)
        const pairs = new Map<number, number>()
        subs.push({ pairs })
        for (let i = 0; i < nset && i < cov.length; i++) {
          const ps = so + t.getUint16(so + 10 + i * 2),
            np = t.getUint16(ps)
          const rec = 2 + vsize(f1) + vsize(f2)
          for (let j = 0; j < np; j++) {
            const r = ps + 2 + j * rec
            const key = cov[i]! * 65536 + t.getUint16(r)
            if (!pairs.has(key)) pairs.set(key, xadv(r + 2, f1))
          }
        }
      } else if (fmt === 2) {
        const c1 = classDef(so + t.getUint16(so + 8)),
          c2 = classDef(so + t.getUint16(so + 10))
        const n1 = t.getUint16(so + 12),
          n2 = t.getUint16(so + 14)
        const rec = vsize(f1) + vsize(f2)
        const vals: number[][] = []
        for (let i = 0; i < n1; i++) {
          const row: number[] = []
          for (let j = 0; j < n2; j++) row.push(xadv(so + 16 + (i * n2 + j) * rec, f1))
          vals.push(row)
        }
        subs.push({ cov: new Set(cov), c1, c2, vals })
      }
    }
  }
  // Each kern lookup adds its first applicable subtable's value.
  return (a, b) => {
    let total = 0
    for (const subs of lookupsSubs) {
      for (const sub of subs) {
        if ('pairs' in sub) {
          const p = sub.pairs.get(a * 65536 + b)
          if (p !== undefined) {
            total += p
            break
          }
        } else if (sub.cov.has(a)) {
          total += sub.vals[sub.c1.get(a) ?? 0]?.[sub.c2.get(b) ?? 0] ?? 0
          break
        }
      }
    }
    return total
  }
}

export function loadFont(buf: Uint8Array): Font {
  const T = woffTables(buf)
  const head = T.get('head')!,
    hhea = T.get('hhea')!,
    hmtx = T.get('hmtx')!,
    maxp = T.get('maxp')!
  const upm = head.getUint16(18)
  const nh = hhea.getUint16(34),
    ng = maxp.getUint16(4)
  const advance = (g: number) => hmtx.getUint16(Math.min(g, nh - 1) * 4)
  let outline: (g: number) => Path
  if (T.get('glyf')) {
    const glyf = T.get('glyf')!,
      loca = T.get('loca')!,
      long = head.getInt16(50) === 1
    const at = (g: number) => (long ? loca.getUint32(g * 4) : loca.getUint16(g * 2) * 2)
    outline = (g) => (g < ng ? glyfOutline(glyf, (i) => [at(i), at(i + 1)], g) : [])
  } else outline = cffFont(T.get('CFF ')!)
  const os2 = T.get('OS/2')
  const ascender = os2 && os2.byteLength > 72 ? os2.getInt16(68) : hhea.getInt16(4)
  const descender = os2 && os2.byteLength > 72 ? os2.getInt16(70) : hhea.getInt16(6)
  const cache = new Map<number, Path>()
  const cached = (g: number) => {
    let p = cache.get(g)
    if (!p) {
      p = outline(g)
      cache.set(g, p)
    }
    return p
  }
  const kern = gposKern(T.get('GPOS'))
  const kcache = new Map<number, number>()
  const kerned = (a: number, b: number) => {
    const k = a * 65536 + b
    let v = kcache.get(k)
    if (v === undefined) {
      v = kern(a, b)
      kcache.set(k, v)
    }
    return v
  }
  return {
    upm,
    ascender,
    descender,
    cmap: parseCmap(T.get('cmap')!),
    advance,
    outline: cached,
    kern: kerned,
  }
}

// ---------- rasterizer (exact area coverage, nonzero approximated by |accumulated|) ----------
/** Coverage (0 to 1) of closed contours, by nonzero, or even-odd when asked (SVG's fill-rule). */
export function rasterize(paths: Path, w: number, h: number, evenOdd = false): Float32Array {
  const acc = new Float32Array(w * h + 2)
  const line = (p0x: number, p0y: number, p1x: number, p1y: number) => {
    if (Math.abs(p0y - p1y) < 1e-9) return
    let dir = 1
    if (p0y > p1y) {
      dir = -1
      ;[p0x, p1x] = [p1x, p0x]
      ;[p0y, p1y] = [p1y, p0y]
    }
    const dxdy = (p1x - p0x) / (p1y - p0y)
    let x = p0x
    if (p0y < 0) x -= p0y * dxdy
    for (let y = Math.max(0, Math.floor(p0y)); y < Math.min(h, Math.ceil(p1y)); y++) {
      const ls = y * w
      const dy = Math.min(y + 1, p1y) - Math.max(y, p0y)
      const xn = x + dxdy * dy
      const d = dy * dir
      const x0 = Math.min(x, xn),
        x1 = Math.max(x, xn)
      const x0f = Math.floor(x0),
        x0i = x0f,
        x1c = Math.ceil(x1),
        x1i = x1c
      if (x0i < 0 || x1i >= w) {
        x = xn
        continue
      }
      if (x1i <= x0i + 1) {
        const xmf = 0.5 * (x + xn) - x0f
        acc[ls + x0i] += d - d * xmf
        acc[ls + x0i + 1] += d * xmf
      } else {
        const s = 1 / (x1 - x0)
        const x0r = x0 - x0f
        const a0 = 0.5 * s * (1 - x0r) * (1 - x0r)
        const x1r = x1 - x1c + 1
        const am = 0.5 * s * x1r * x1r
        acc[ls + x0i] += d * a0
        if (x1i === x0i + 2) acc[ls + x0i + 1] += d * (1 - a0 - am)
        else {
          const a1 = s * (1.5 - x0r)
          acc[ls + x0i + 1] += d * (a1 - a0)
          for (let xi = x0i + 2; xi < x1i - 1; xi++) acc[ls + xi] += d * s
          const a2 = a1 + (x1i - x0i - 3) * s
          acc[ls + x1i - 1] += d * (1 - a2 - am)
        }
        acc[ls + x1i] += d * am
      }
      x = xn
    }
  }
  for (const c of paths)
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!,
        b = c[(i + 1) % c.length]!
      line(a[0], a[1], b[0], b[1])
    }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x < w; x++) {
      s += acc[y * w + x]!
      const t = Math.abs(s)
      out[y * w + x] = evenOdd ? (t % 2 > 1 ? 2 - (t % 2) : t % 2) : Math.min(1, t)
    }
  }
  return out
}

const fonts = new Map<string, Font | null>()
/** A face's weight, read once; null when its file is not there. */
export function fontFor(face: Face, weight: number): Font | null {
  const key = `${face.id}:${weight}`
  if (!fonts.has(key)) {
    const bytes = readFontFile(face, weight)
    fonts.set(key, bytes ? loadFont(bytes) : null)
  }
  return fonts.get(key) ?? null
}

const EMPTY: Rendered = { mask: { w: 1, h: 1, a: new Float32Array(1) }, baseline: 0, advance: 0 }

export function renderText(font: Font, size: number, text: string, trackingPx = 0): Rendered {
  const sc = size / font.upm
  const gids = [...text].map((ch) => font.cmap.get(ch.codePointAt(0)!) ?? 0)
  const pens: number[] = []
  let pen = 0
  gids.forEach((g, i) => {
    pens.push(pen)
    pen += font.advance(g) * sc + trackingPx
    if (i + 1 < gids.length) pen += font.kern(g, gids[i + 1]!) * sc
  })
  const pad = 3
  const asc = Math.ceil(font.ascender * sc),
    des = Math.ceil(-font.descender * sc)
  const w = Math.ceil(pen + size * 0.3) + 2 * pad,
    h = asc + des + 2 * pad
  const base = pad + asc
  const paths: Path = []
  gids.forEach((g, i) => {
    for (const c of font.outline(g))
      paths.push(c.map(([x, y]) => [pad + pens[i]! + x * sc, base - y * sc] as Pt))
  })
  const a = rasterize(paths, w, h)
  return { mask: { w, h, a } as Mask, baseline: base, advance: pen }
}

/** The server's renderer: each face drawn from its WOFF file; a missing file draws nothing. */
export function woffRenderer(): Renderer {
  return {
    name: 'ts-raster',
    render(reqs) {
      return reqs.map((r) => {
        const font = fontFor(r.face, r.weight)
        return font ? renderText(font, r.size, r.text, r.trackingPx ?? 0) : EMPTY
      })
    },
  }
}
