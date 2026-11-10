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
import type { Path } from '../extract/fonts/sfnt'
import {
  attr,
  multiply,
  numbers,
  parseTransform,
  scaleOf,
  shapeOutline,
  strokeContours,
  type Matrix,
} from './svg-geometry'

/** The largest SVG read, in bytes. */
const MAX_BYTES = 1024 * 1024
/** The most elements and points drawn, so a hostile file cannot stall the server. */
const MAX_ELEMENTS = 4000
const MAX_POINTS = 400_000

type Rgba = [number, number, number, number]

interface Node {
  tag: string
  attrs: Record<string, string>
  children: Node[]
  text: string
}

class Unsupported extends Error {}

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
    box.length === 4 ? box : [0, 0, attr(svg.attrs, 'width'), attr(svg.attrs, 'height')]
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
      const moved = multiply(matrix, [1, 0, 0, 1, attr(node.attrs, 'x'), attr(node.attrs, 'y')])
      if (target.tag === 'symbol')
        for (const child of target.children) visit(child, own, moved, depth + 1)
      else visit(target, own, moved, depth + 1)
      return
    }
    if (style.visibility === 'hidden') return
    const outline = shapeOutline(node.tag, node.attrs, matrix)
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
