/**
 * The geometry of an SVG icon (svg.ts): transforms, paths and basic shapes
 * as outlines in device space, and strokes as filled pieces.
 */
import type { Path, Pt } from '../extract/fonts/sfnt'

export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

export const apply = (m: Matrix, x: number, y: number): Pt => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

/** How much the matrix scales lengths, on average. */
export const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g

export const numbers = (text: string): number[] => (text.match(NUMBER) ?? []).map(Number)

export function parseTransform(text: string | undefined): Matrix {
  let m = IDENTITY
  if (!text) return m
  for (const [, name, args] of text.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = numbers(args!)
    let t: Matrix = IDENTITY
    if (name === 'matrix' && a.length === 6) t = a as Matrix
    else if (name === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
    else if (name === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
    else if (name === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0]
      t = multiply(
        multiply([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]),
        [1, 0, 0, 1, -cx, -cy]
      )
    } else if (name === 'skewX') t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
    else if (name === 'skewY') t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
    m = multiply(m, t)
  }
  return m
}

/** Points along an elliptical arc, from SVG's endpoint form (spec F.6.5). */
function arcPoints(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angle: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
  steps: (radius: number, sweep: number) => number
): Pt[] {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (!rx || !ry) return [[x2, y2]]
  const phi = (angle * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const xp = cos * dx + sin * dy
  const yp = -sin * dx + cos * dy
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
  const den = rx * rx * yp * yp + ry * ry * xp * xp
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * rx * yp) / ry
  const cyp = (-coef * ry * xp) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const angleOf = (ux: number, uy: number) => Math.atan2(uy, ux)
  const t1 = angleOf((xp - cxp) / rx, (yp - cyp) / ry)
  let dt = angleOf((-xp - cxp) / rx, (-yp - cyp) / ry) - t1
  if (sweep && dt < 0) dt += 2 * Math.PI
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  const n = steps(Math.max(rx, ry), Math.abs(dt))
  const out: Pt[] = []
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy])
  }
  return out
}

/** A path's subpaths as points in device space; `closed` marks those ended with Z. */
export interface Outline {
  points: Pt[][]
  closed: boolean[]
}

export function pathOutline(d: string, m: Matrix): Outline {
  const out: Outline = { points: [], closed: [] }
  const scale = scaleOf(m)
  const curveSteps = (len: number) => Math.min(64, Math.max(4, Math.ceil(len * scale)))
  const arcSteps = (radius: number, sweep: number) =>
    Math.min(96, Math.max(4, Math.ceil(radius * scale * sweep)))
  const tokens = d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let cx = 0
  let cy = 0
  let qx = 0
  let qy = 0
  let prev = ''
  let current: Pt[] | null = null
  const user: Pt[][] = []
  const start = () => {
    current = [[x, y]]
    user.push(current)
    out.closed.push(false)
  }
  const to = (p: Pt) => {
    if (!current) start()
    current!.push(p)
  }
  const isNum = (t: string | undefined) => t !== undefined && !/^[a-zA-Z]$/.test(t)
  const num = () => Number(tokens[i++])
  // Arc flags may be written together ("a1 1 0 01 2 2"): one digit each.
  const flag = () => {
    const t = tokens[i]!
    if (t.length > 1 && (t[0] === '0' || t[0] === '1')) {
      tokens[i] = t.slice(1)
      return t[0] === '1'
    }
    i++
    return t === '1'
  }
  while (i < tokens.length) {
    if (!isNum(tokens[i])) cmd = tokens[i++]!
    else if (!cmd) break
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    if (C === 'Z') {
      if (current) out.closed[out.closed.length - 1] = true
      x = sx
      y = sy
      current = null
      prev = C
      continue
    }
    if (!isNum(tokens[i])) {
      // A command with no numbers is malformed: stop drawing here.
      break
    }
    if (C === 'M') {
      x = ox + num()
      y = oy + num()
      sx = x
      sy = y
      start()
      cmd = rel ? 'l' : 'L'
    } else if (C === 'L') {
      x = ox + num()
      y = oy + num()
      to([x, y])
    } else if (C === 'H') {
      x = ox + num()
      to([x, y])
    } else if (C === 'V') {
      y = oy + num()
      to([x, y])
    } else if (C === 'C' || C === 'S') {
      let x1: number
      let y1: number
      if (C === 'C') {
        x1 = ox + num()
        y1 = oy + num()
      } else {
        x1 = prev === 'C' || prev === 'S' ? 2 * x - cx : x
        y1 = prev === 'C' || prev === 'S' ? 2 * y - cy : y
      }
      const x2 = ox + num()
      const y2 = oy + num()
      const ex = ox + num()
      const ey = oy + num()
      const n = curveSteps(
        Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(ex - x2, ey - y2)
      )
      for (let k = 1; k <= n; k++) {
        const t = k / n
        const u = 1 - t
        to([
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
        ])
      }
      cx = x2
      cy = y2
      x = ex
      y = ey
    } else if (C === 'Q' || C === 'T') {
      if (C === 'Q') {
        qx = ox + num()
        qy = oy + num()
      } else {
        qx = prev === 'Q' || prev === 'T' ? 2 * x - qx : x
        qy = prev === 'Q' || prev === 'T' ? 2 * y - qy : y
      }
      const ex = ox + num()
      const ey = oy + num()
      const n = curveSteps(Math.hypot(qx - x, qy - y) + Math.hypot(ex - qx, ey - qy))
      for (let k = 1; k <= n; k++) {
        const t = k / n
        const u = 1 - t
        to([u * u * x + 2 * u * t * qx + t * t * ex, u * u * y + 2 * u * t * qy + t * t * ey])
      }
      x = ex
      y = ey
    } else if (C === 'A') {
      const rx = num()
      const ry = num()
      const angle = num()
      const large = flag()
      const sweep = flag()
      const ex = ox + num()
      const ey = oy + num()
      for (const p of arcPoints(x, y, rx, ry, angle, large, sweep, ex, ey, arcSteps)) to(p)
      x = ex
      y = ey
    } else {
      break
    }
    prev = C
  }
  out.points = user.map((sub) => sub.map(([px, py]) => apply(m, px, py)))
  return out
}

export function ellipseOutline(cx: number, cy: number, rx: number, ry: number, m: Matrix): Outline {
  if (rx <= 0 || ry <= 0) return { points: [], closed: [] }
  const n = Math.min(128, Math.max(16, Math.ceil(Math.max(rx, ry) * scaleOf(m))))
  const pts: Pt[] = []
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n
    pts.push(apply(m, cx + rx * Math.cos(t), cy + ry * Math.sin(t)))
  }
  return { points: [pts], closed: [true] }
}

/** A number attribute, or the fallback. */
export const attr = (attrs: Record<string, string>, key: string, fallback = 0) => {
  const v = parseFloat(attrs[key] ?? '')
  return Number.isFinite(v) ? v : fallback
}

/** A basic shape or path as an outline in device space; null for anything else. */
export function shapeOutline(
  tag: string,
  attrs: Record<string, string>,
  m: Matrix
): Outline | null {
  const node = { tag, attrs }
  switch (tag) {
    case 'path':
      return pathOutline(node.attrs.d ?? '', m)
    case 'rect': {
      const [x, y, w, h] = [
        attr(node.attrs, 'x'),
        attr(node.attrs, 'y'),
        attr(node.attrs, 'width'),
        attr(node.attrs, 'height'),
      ]
      if (w <= 0 || h <= 0) return null
      let rx = node.attrs.rx !== undefined ? attr(node.attrs, 'rx') : attr(node.attrs, 'ry')
      let ry = node.attrs.ry !== undefined ? attr(node.attrs, 'ry') : rx
      rx = Math.min(rx, w / 2)
      ry = Math.min(ry, h / 2)
      const d =
        rx > 0 && ry > 0
          ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
          : `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      return pathOutline(d, m)
    }
    case 'circle':
      return ellipseOutline(
        attr(node.attrs, 'cx'),
        attr(node.attrs, 'cy'),
        attr(node.attrs, 'r'),
        attr(node.attrs, 'r'),
        m
      )
    case 'ellipse':
      return ellipseOutline(
        attr(node.attrs, 'cx'),
        attr(node.attrs, 'cy'),
        attr(node.attrs, 'rx'),
        attr(node.attrs, 'ry'),
        m
      )
    case 'line':
      return pathOutline(
        `M${attr(node.attrs, 'x1')} ${attr(node.attrs, 'y1')}L${attr(node.attrs, 'x2')} ${attr(node.attrs, 'y2')}`,
        m
      )
    case 'polygon':
    case 'polyline': {
      const n = numbers(node.attrs.points ?? '')
      if (n.length < 4) return null
      const d = `M${n.slice(0, 2).join(' ')}L${n.slice(2, n.length - (n.length % 2)).join(' ')}${node.tag === 'polygon' ? 'Z' : ''}`
      return pathOutline(d, m)
    }
    default:
      return null
  }
}

const signedArea = (pts: Pt[]) => {
  let a = 0
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!
    const q = pts[(k + 1) % pts.length]!
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a
}

/** One winding for every piece of a stroke, so their union is filled by nonzero. */
const wound = (pts: Pt[]) => (signedArea(pts) < 0 ? pts.reverse() : pts)

/** A stroke as filled pieces: a quad per segment and a disc at every point (round joins and caps). */
export function strokeContours(outline: Outline, width: number): Path {
  const half = width / 2
  if (half <= 0) return []
  const discSteps = Math.min(32, Math.max(8, Math.ceil(half * 2)))
  const pieces: Path = []
  outline.points.forEach((pts, index) => {
    const line = outline.closed[index] && pts.length > 2 ? [...pts, pts[0]!] : pts
    for (let k = 0; k < line.length; k++) {
      const [px, py] = line[k]!
      const disc: Pt[] = []
      for (let s = 0; s < discSteps; s++) {
        const t = (2 * Math.PI * s) / discSteps
        disc.push([px + half * Math.cos(t), py + half * Math.sin(t)])
      }
      pieces.push(wound(disc))
      const next = line[k + 1]
      if (!next) continue
      const len = Math.hypot(next[0] - px, next[1] - py)
      if (len < 1e-6) continue
      const nx = (-(next[1] - py) / len) * half
      const ny = ((next[0] - px) / len) * half
      pieces.push(
        wound([
          [px + nx, py + ny],
          [next[0] + nx, next[1] + ny],
          [next[0] - nx, next[1] - ny],
          [px - nx, py - ny],
        ])
      )
    }
  })
  return pieces
}
