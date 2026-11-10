/**
 * A brand icon stored as SVG, drawn to pixels for the share card, the
 * favicon square and email headers, which cannot take SVG. Covers what
 * logos are made of: paths and basic shapes, fills and strokes in flat
 * colours (a gradient draws as its first stop), groups with transforms and
 * opacity, <use>, and class or element rules in a <style>. An icon with
 * text, an embedded image or nothing drawable gives null, so the caller
 * draws the brand's initial instead of a wrong icon.
 *
 * Pure: no app imports beyond the font rasterizer, which it shares.
 */
import type { Image } from '../extract/png'
import { rasterize } from '../extract/fonts/woff'
import type { Path, Pt } from '../extract/fonts/sfnt'

/** The largest SVG read, in bytes. */
const MAX_BYTES = 1024 * 1024
/** The most elements and points drawn, so a hostile file cannot stall the server. */
const MAX_ELEMENTS = 4000
const MAX_POINTS = 400_000

type Matrix = [number, number, number, number, number, number]
type Rgba = [number, number, number, number]

interface Node {
  tag: string
  attrs: Record<string, string>
  children: Node[]
  text: string
}

class Unsupported extends Error {}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const apply = (m: Matrix, x: number, y: number): Pt => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

/** How much the matrix scales lengths, on average. */
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g

const numbers = (text: string): number[] => (text.match(NUMBER) ?? []).map(Number)

function parseTransform(text: string | undefined): Matrix {
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

// ---------- XML ----------

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseXml(text: string): Node | null {
  const root: Node = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const clean = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<![^>]*>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
  const tag = /<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let last = 0
  let count = 0
  for (let m = tag.exec(clean); m; m = tag.exec(clean)) {
    stack[stack.length - 1]!.text += clean.slice(last, m.index)
    last = tag.lastIndex
    const [, closing, name, rest, selfClosing] = m
    if (closing) {
      if (stack.length > 1) stack.pop()
      continue
    }
    if (++count > MAX_ELEMENTS) throw new Unsupported('too many elements')
    const attrs: Record<string, string> = {}
    for (const [, key, dq, sq] of rest!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attrs[key!] = decodeEntities(dq ?? sq ?? '')
    const node: Node = { tag: name!.replace(/^svg:/, ''), attrs, children: [], text: '' }
    stack[stack.length - 1]!.children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root.children.find((n) => n.tag === 'svg') ?? null
}

// ---------- style ----------

type Rules = Array<{ selector: string; decls: Record<string, string> }>

function declarations(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of text.split(';')) {
    const at = part.indexOf(':')
    if (at > 0) out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim()
  }
  return out
}

function parseCss(text: string): Rules {
  const rules: Rules = []
  for (const [, selectors, body] of text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = declarations(body!)
    for (const selector of selectors!.split(',')) rules.push({ selector: selector.trim(), decls })
  }
  return rules
}

function matches(selector: string, node: Node): boolean {
  if (selector === '*') return true
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(selector)
  if (!m) return false
  if (m[1] && m[1] !== node.tag) return false
  const classes = (node.attrs.class ?? '').split(/\s+/)
  for (const [, kind, name] of (m[2] ?? '').matchAll(/([.#])([\w-]+)/g)) {
    if (kind === '.' && !classes.includes(name!)) return false
    if (kind === '#' && node.attrs.id !== name) return false
  }
  return true
}

/** The node's own presentation: attributes, then style rules, then its style attribute. */
function ownStyle(node: Node, rules: Rules): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of [
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'opacity',
    'color',
    'display',
    'visibility',
  ])
    if (node.attrs[key] !== undefined) out[key] = node.attrs[key]!
  for (const rule of rules) if (matches(rule.selector, node)) Object.assign(out, rule.decls)
  if (node.attrs.style) Object.assign(out, declarations(node.attrs.style))
  return out
}

// ---------- colour ----------

const NAMED: Record<string, Rgba> = {
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
  red: [255, 0, 0, 1],
  green: [0, 128, 0, 1],
  blue: [0, 0, 255, 1],
  yellow: [255, 255, 0, 1],
  orange: [255, 165, 0, 1],
  purple: [128, 0, 128, 1],
  gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1],
  silver: [192, 192, 192, 1],
  navy: [0, 0, 128, 1],
  teal: [0, 128, 128, 1],
  transparent: [0, 0, 0, 0],
}

function parseColour(text: string, current: Rgba): Rgba | null {
  const v = text.trim().toLowerCase()
  if (!v || v === 'none') return null
  if (v === 'currentcolor') return current
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1]
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(v)?.[1]
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean)
    const channel = (p: string | undefined) =>
      p?.endsWith('%') ? (parseFloat(p) * 255) / 100 : Number(p ?? 0)
    const alpha = parts[3]
      ? parts[3].endsWith('%')
        ? parseFloat(parts[3]) / 100
        : Number(parts[3])
      : 1
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha]
  }
  return NAMED[v] ?? [0, 0, 0, 1]
}

// ---------- geometry ----------

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
interface Outline {
  points: Pt[][]
  closed: boolean[]
}

function pathOutline(d: string, m: Matrix): Outline {
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

function ellipseOutline(cx: number, cy: number, rx: number, ry: number, m: Matrix): Outline {
  if (rx <= 0 || ry <= 0) return { points: [], closed: [] }
  const n = Math.min(128, Math.max(16, Math.ceil(Math.max(rx, ry) * scaleOf(m))))
  const pts: Pt[] = []
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n
    pts.push(apply(m, cx + rx * Math.cos(t), cy + ry * Math.sin(t)))
  }
  return { points: [pts], closed: [true] }
}

const attr = (node: Node, key: string, fallback = 0) => {
  const v = parseFloat(node.attrs[key] ?? '')
  return Number.isFinite(v) ? v : fallback
}

function shapeOutline(node: Node, m: Matrix): Outline | null {
  switch (node.tag) {
    case 'path':
      return pathOutline(node.attrs.d ?? '', m)
    case 'rect': {
      const [x, y, w, h] = [
        attr(node, 'x'),
        attr(node, 'y'),
        attr(node, 'width'),
        attr(node, 'height'),
      ]
      if (w <= 0 || h <= 0) return null
      let rx = node.attrs.rx !== undefined ? attr(node, 'rx') : attr(node, 'ry')
      let ry = node.attrs.ry !== undefined ? attr(node, 'ry') : rx
      rx = Math.min(rx, w / 2)
      ry = Math.min(ry, h / 2)
      const d =
        rx > 0 && ry > 0
          ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
          : `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      return pathOutline(d, m)
    }
    case 'circle':
      return ellipseOutline(attr(node, 'cx'), attr(node, 'cy'), attr(node, 'r'), attr(node, 'r'), m)
    case 'ellipse':
      return ellipseOutline(
        attr(node, 'cx'),
        attr(node, 'cy'),
        attr(node, 'rx'),
        attr(node, 'ry'),
        m
      )
    case 'line':
      return pathOutline(
        `M${attr(node, 'x1')} ${attr(node, 'y1')}L${attr(node, 'x2')} ${attr(node, 'y2')}`,
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
function strokeContours(outline: Outline, width: number): Path {
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

// ---------- drawing ----------

interface Inherited {
  fill: string
  fillOpacity: number
  fillRule: string
  stroke: string
  strokeWidth: number
  strokeOpacity: number
  opacity: number
  color: Rgba
}

interface Canvas {
  img: Image
  points: number
}

function paint(canvas: Canvas, contours: Path, colour: Rgba, alpha: number, evenOdd: boolean) {
  const { img } = canvas
  for (const c of contours) canvas.points += c.length
  if (canvas.points > MAX_POINTS) throw new Unsupported('too many points')
  const cover = rasterize(contours, img.width, img.height, evenOdd)
  const a0 = colour[3] * alpha
  for (let p = 0; p < cover.length; p++) {
    const a = cover[p]! * a0
    if (a <= 0) continue
    const o = p * 4
    const da = img.data[o + 3]! / 255
    const oa = a + da * (1 - a)
    for (let c = 0; c < 3; c++)
      img.data[o + c] = Math.round((colour[c]! * a + img.data[o + c]! * da * (1 - a)) / oa)
    img.data[o + 3] = Math.round(oa * 255)
  }
}

export function rasteriseSvg(bytes: Uint8Array, maxSide: number): Image | null {
  if (bytes.byteLength > MAX_BYTES) return null
  try {
    return draw(new TextDecoder().decode(bytes), maxSide)
  } catch {
    return null
  }
}

function draw(text: string, maxSide: number): Image | null {
  const svg = parseXml(text)
  if (!svg) return null
  const byId = new Map<string, Node>()
  let css = ''
  const index = (node: Node) => {
    if (node.attrs.id) byId.set(node.attrs.id, node)
    if (node.tag === 'style') css += node.text
    node.children.forEach(index)
  }
  index(svg)
  const rules = parseCss(css)

  const box = numbers(svg.attrs.viewBox ?? svg.attrs.viewbox ?? '')
  const [minX, minY, vw, vh] =
    box.length === 4 ? box : [0, 0, attr(svg, 'width'), attr(svg, 'height')]
  if (!(vw! > 0 && vh! > 0)) return null
  const scale = maxSide / Math.max(vw!, vh!)
  const width = Math.max(1, Math.round(vw! * scale))
  const height = Math.max(1, Math.round(vh! * scale))
  const canvas: Canvas = {
    img: { width, height, data: new Uint8Array(width * height * 4) },
    points: 0,
  }

  /** A gradient's first stop, as flat colour, following its href for stops. */
  const gradientColour = (id: string, current: Rgba): Rgba | null => {
    let node = byId.get(id)
    for (let hops = 0; node && hops < 4; hops++) {
      const stop = node.children.find((c) => c.tag === 'stop')
      if (stop) {
        const style = ownStyle(stop, rules)
        const colour = parseColour(
          style['stop-color'] ?? stop.attrs['stop-color'] ?? 'black',
          current
        )
        if (!colour) return null
        const opacity = parseFloat(style['stop-opacity'] ?? stop.attrs['stop-opacity'] ?? '1')
        return [
          colour[0],
          colour[1],
          colour[2],
          colour[3] * (Number.isFinite(opacity) ? opacity : 1),
        ]
      }
      const href = (node.attrs.href ?? node.attrs['xlink:href'] ?? '').replace(/^#/, '')
      node = href ? byId.get(href) : undefined
    }
    return null
  }

  const paintOf = (value: string, current: Rgba): Rgba | null => {
    const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value.trim())
    return url ? gradientColour(url[1]!, current) : parseColour(value, current)
  }

  const SKIP = new Set([
    'defs',
    'clipPath',
    'mask',
    'symbol',
    'linearGradient',
    'radialGradient',
    'pattern',
    'marker',
    'filter',
    'title',
    'desc',
    'metadata',
    'style',
  ])
  const UNDRAWABLE = new Set(['text', 'image', 'foreignObject'])

  const visit = (node: Node, parent: Inherited, m: Matrix, depth: number) => {
    if (depth > 32 || SKIP.has(node.tag)) return
    if (UNDRAWABLE.has(node.tag)) throw new Unsupported(node.tag)
    const style = ownStyle(node, rules)
    if (style.display === 'none') return
    const num = (v: string | undefined, fallback: number) => {
      const n = parseFloat(v ?? '')
      return Number.isFinite(n) ? n : fallback
    }
    const color = style.color
      ? (parseColour(style.color, parent.color) ?? parent.color)
      : parent.color
    const own: Inherited = {
      fill: style.fill ?? parent.fill,
      fillOpacity: num(style['fill-opacity'], parent.fillOpacity),
      fillRule: style['fill-rule'] ?? parent.fillRule,
      stroke: style.stroke ?? parent.stroke,
      strokeWidth: num(style['stroke-width'], parent.strokeWidth),
      strokeOpacity: num(style['stroke-opacity'], parent.strokeOpacity),
      // Group opacity is applied to each shape inside it: close for logos, which rarely overlap.
      opacity: parent.opacity * num(style.opacity, 1),
      color,
    }
    const matrix = multiply(m, parseTransform(node.attrs.transform))
    if (node.tag === 'svg' || node.tag === 'g' || node.tag === 'a' || node.tag === 'switch') {
      for (const child of node.children) visit(child, own, matrix, depth + 1)
      return
    }
    if (node.tag === 'use') {
      const href = (node.attrs.href ?? node.attrs['xlink:href'] ?? '').replace(/^#/, '')
      const target = byId.get(href)
      if (!target || target === node) return
      const moved = multiply(matrix, [1, 0, 0, 1, attr(node, 'x'), attr(node, 'y')])
      if (target.tag === 'symbol')
        for (const child of target.children) visit(child, own, moved, depth + 1)
      else visit(target, own, moved, depth + 1)
      return
    }
    if (style.visibility === 'hidden') return
    const outline = shapeOutline(node, matrix)
    if (!outline || !outline.points.length) return
    const fill = node.tag === 'line' ? null : paintOf(own.fill, own.color)
    if (fill) {
      const closed = outline.points.filter((pts) => pts.length > 2)
      paint(canvas, closed, fill, own.fillOpacity * own.opacity, own.fillRule === 'evenodd')
    }
    const stroke = paintOf(own.stroke, own.color)
    if (stroke) {
      const contours = strokeContours(outline, own.strokeWidth * scaleOf(matrix))
      paint(canvas, contours, stroke, own.strokeOpacity * own.opacity, false)
    }
  }

  const base: Matrix = [scale, 0, 0, scale, -minX! * scale, -minY! * scale]
  const initial: Inherited = {
    fill: 'black',
    fillOpacity: 1,
    fillRule: 'nonzero',
    stroke: 'none',
    strokeWidth: 1,
    strokeOpacity: 1,
    opacity: 1,
    color: [0, 0, 0, 1],
  }
  // The root's own attributes (fill, stroke, transform) apply; its width and height are the box.
  const root = { ...svg, attrs: { ...svg.attrs, transform: '' } }
  visit(root, initial, base, 0)

  const { data } = canvas.img
  for (let o = 3; o < data.length; o += 4) if (data[o]! > 0) return canvas.img
  return null
}
