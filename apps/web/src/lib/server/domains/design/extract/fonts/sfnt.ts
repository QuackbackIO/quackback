/**
 * A WOFF (or bare sfnt) font's tables, its character map and its TrueType
 * glyph outlines, flattened to polylines in font units.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { inflateSync } from 'node:zlib'

export type Pt = [number, number]
/** Closed polylines, in font units. */
export type Path = Pt[][]

// ---------- sfnt from WOFF ----------
export function woffTables(buf: Uint8Array): Map<string, DataView> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const sig = String.fromCharCode(...buf.subarray(0, 4))
  const tables = new Map<string, DataView>()
  if (sig === 'wOFF') {
    const n = dv.getUint16(12)
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20
      const tag = String.fromCharCode(...buf.subarray(o, o + 4))
      const off = dv.getUint32(o + 4),
        comp = dv.getUint32(o + 8),
        orig = dv.getUint32(o + 12)
      const raw = buf.subarray(off, off + comp)
      const data = comp < orig ? new Uint8Array(inflateSync(raw)) : raw
      tables.set(tag, new DataView(data.buffer, data.byteOffset, data.byteLength))
    }
  } else {
    const n = dv.getUint16(4)
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16
      const tag = String.fromCharCode(...buf.subarray(o, o + 4))
      tables.set(
        tag,
        new DataView(buf.buffer, buf.byteOffset + dv.getUint32(o + 8), dv.getUint32(o + 12))
      )
    }
  }
  return tables
}

export function parseCmap(t: DataView): Map<number, number> {
  const map = new Map<number, number>()
  const n = t.getUint16(2)
  let best = -1,
    bestFmt = 0
  for (let i = 0; i < n; i++) {
    const pid = t.getUint16(4 + i * 8),
      eid = t.getUint16(6 + i * 8),
      off = t.getUint32(8 + i * 8)
    const fmt = t.getUint16(off)
    if ((pid === 3 && (eid === 1 || eid === 10)) || pid === 0) {
      if (fmt === 12 || (fmt === 4 && bestFmt !== 12)) {
        best = off
        bestFmt = fmt
      }
    }
  }
  if (best < 0) return map
  if (bestFmt === 4) {
    const segX2 = t.getUint16(best + 6),
      seg = segX2 / 2
    const ends = best + 14,
      starts = ends + segX2 + 2,
      deltas = starts + segX2,
      ranges = deltas + segX2
    for (let s = 0; s < seg; s++) {
      const end = t.getUint16(ends + s * 2),
        start = t.getUint16(starts + s * 2)
      const delta = t.getInt16(deltas + s * 2),
        ro = t.getUint16(ranges + s * 2)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number
        if (ro === 0) g = (c + delta) & 0xffff
        else {
          const gi = ranges + s * 2 + ro + (c - start) * 2
          g = t.getUint16(gi)
          if (g) g = (g + delta) & 0xffff
        }
        if (g) map.set(c, g)
      }
    }
  } else {
    const groups = t.getUint32(best + 12)
    for (let i = 0; i < groups; i++) {
      const o = best + 16 + i * 12
      const s = t.getUint32(o),
        e = t.getUint32(o + 4),
        g0 = t.getUint32(o + 8)
      for (let c = s; c <= e; c++) map.set(c, g0 + c - s)
    }
  }
  return map
}

// ---------- TrueType glyf ----------
export function glyfOutline(
  glyf: DataView,
  loca: (g: number) => [number, number],
  g: number,
  depth = 0
): Path {
  const [a, b] = loca(g)
  if (b <= a || depth > 8) return []
  const nc = glyf.getInt16(a)
  if (nc >= 0) {
    let p = a + 10
    const ends: number[] = []
    for (let i = 0; i < nc; i++) {
      ends.push(glyf.getUint16(p))
      p += 2
    }
    const np = nc ? ends[nc - 1]! + 1 : 0
    p += 2 + glyf.getUint16(p)
    const flags: number[] = []
    while (flags.length < np) {
      const f = glyf.getUint8(p++)
      flags.push(f)
      if (f & 8) {
        let r = glyf.getUint8(p++)
        while (r--) flags.push(f)
      }
    }
    const xs: number[] = [],
      ys: number[] = []
    let v = 0
    for (const f of flags) {
      if (f & 2) {
        const d = glyf.getUint8(p++)
        v += f & 16 ? d : -d
      } else if (!(f & 16)) {
        v += glyf.getInt16(p)
        p += 2
      }
      xs.push(v)
    }
    v = 0
    for (const f of flags) {
      if (f & 4) {
        const d = glyf.getUint8(p++)
        v += f & 32 ? d : -d
      } else if (!(f & 32)) {
        v += glyf.getInt16(p)
        p += 2
      }
      ys.push(v)
    }
    const path: Path = []
    let s = 0
    for (const e of ends) {
      const pts = []
      for (let i = s; i <= e; i++) pts.push({ x: xs[i]!, y: ys[i]!, on: !!(flags[i]! & 1) })
      s = e + 1
      if (pts.length) path.push(flattenQuad(pts))
    }
    return path
  }
  // Composite.
  let p = a + 10
  const path: Path = []
  for (;;) {
    const flags = glyf.getUint16(p),
      gi = glyf.getUint16(p + 2)
    p += 4
    let dx: number, dy: number
    if (flags & 1) {
      dx = glyf.getInt16(p)
      dy = glyf.getInt16(p + 2)
      p += 4
    } else {
      dx = glyf.getInt8(p)
      dy = glyf.getInt8(p + 1)
      p += 2
    }
    let m = [1, 0, 0, 1]
    const f2 = (o: number) => glyf.getInt16(o) / 16384
    if (flags & 8) {
      const s = f2(p)
      m = [s, 0, 0, s]
      p += 2
    } else if (flags & 0x40) {
      m = [f2(p), 0, 0, f2(p + 2)]
      p += 4
    } else if (flags & 0x80) {
      m = [f2(p), f2(p + 2), f2(p + 4), f2(p + 6)]
      p += 8
    }
    if (!(flags & 2)) {
      dx = 0
      dy = 0
    } // point matching: rare in these faces
    for (const c of glyfOutline(glyf, loca, gi, depth + 1))
      path.push(c.map(([x, y]) => [m[0]! * x + m[2]! * y + dx, m[1]! * x + m[3]! * y + dy] as Pt))
    if (!(flags & 0x20)) break
  }
  return path
}

function flattenQuad(pts: Array<{ x: number; y: number; on: boolean }>): Pt[] {
  // Start at an on-curve point (or the midpoint of the first two off-curve points).
  const n = pts.length
  let start = pts.findIndex((q) => q.on)
  let first: { x: number; y: number }
  if (start < 0) {
    first = { x: (pts[0]!.x + pts[1 % n]!.x) / 2, y: (pts[0]!.y + pts[1 % n]!.y) / 2 }
    start = 0
  } else first = pts[start]!
  const out: Pt[] = [[first.x, first.y]]
  let cur = first,
    ctrl: { x: number; y: number } | null = null
  const quad = (
    p0: { x: number; y: number },
    c: { x: number; y: number },
    p1: { x: number; y: number }
  ) => {
    const steps = Math.max(2, Math.min(16, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 40)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        u = 1 - t
      out.push([
        u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
        u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
      ])
    }
  }
  for (let k = 1; k <= n; k++) {
    const q = pts[(start + k) % n]!
    const isLast = k === n
    const target = isLast && pts[start]!.on ? pts[start]! : q
    if (target.on) {
      if (ctrl) quad(cur, ctrl, target)
      else out.push([target.x, target.y])
      cur = target
      ctrl = null
    } else {
      if (ctrl) {
        const mid = { x: (ctrl.x + q.x) / 2, y: (ctrl.y + q.y) / 2 }
        quad(cur, ctrl, mid)
        cur = mid
      }
      ctrl = q
    }
  }
  if (ctrl) quad(cur, ctrl, first)
  return out
}
