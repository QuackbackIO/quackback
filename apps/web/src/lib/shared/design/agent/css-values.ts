/**
 * Reading computed CSS values as the verifier compares them: colours in
 * whatever form a browser reports (rgb(), color(srgb), oklch(), oklab(),
 * hex), as hex with alpha and a perceptual lightness; shadows as their
 * strongest layer; lengths as px.
 */
import { hexToOklch } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'

export interface Colour {
  hex: string
  alpha: number
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((c) =>
      Math.round(clamp(c, 0, 255))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`

const num = (text: string, scale = 1) =>
  text.endsWith('%') ? (parseFloat(text) / 100) * scale : parseFloat(text)

/** Linear sRGB channel to gamma-encoded 0..255. */
const encode = (c: number) =>
  255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055)

function oklabToHex(l: number, a: number, b: number): string {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const [L, M, S] = [l_ ** 3, m_ ** 3, s_ ** 3]
  return toHex(
    encode(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    encode(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    encode(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S)
  )
}

/** The colour a CSS colour value names, or null for one it cannot read. */
export function parseCssColour(value: string | null | undefined): Colour | null {
  if (!value) return null
  const text = value.trim().toLowerCase()
  if (text === 'transparent') return { hex: '#000000', alpha: 0 }
  const hex = /^#([\da-f]{3,8})$/.exec(text)
  if (hex) {
    const d = hex[1]!
    const full =
      d.length === 3 || d.length === 4 ? [...d].map((c) => c + c).join('') : d.padEnd(6, '0')
    return {
      hex: `#${full.slice(0, 6)}`,
      alpha: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    }
  }
  const fn = /^([a-z]+)\((.*)\)$/.exec(text)
  if (!fn) return null
  const [, name, inner] = fn
  const [main, slash] = inner!.split('/')
  const parts = main!.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean)
  let alpha = slash !== undefined ? num(slash.trim()) : 1
  if (name === 'rgb' || name === 'rgba') {
    if (parts.length === 4 && slash === undefined) alpha = num(parts[3]!)
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255))
    if ([r, g, b].some((c) => c === undefined || Number.isNaN(c))) return null
    return { hex: toHex(r!, g!, b!), alpha: clamp(alpha) }
  }
  if (name === 'color' && parts[0] === 'srgb') {
    const [r, g, b] = parts.slice(1, 4).map((p) => num(p) * 255)
    if ([r, g, b].some((c) => c === undefined || Number.isNaN(c))) return null
    return { hex: toHex(r!, g!, b!), alpha: clamp(alpha) }
  }
  if (name === 'oklch') {
    const [l, c, h] = [num(parts[0] ?? ''), num(parts[1] ?? '', 0.4), parseFloat(parts[2] ?? '0')]
    if ([l, c].some(Number.isNaN)) return null
    const rad = ((Number.isNaN(h) ? 0 : h) * Math.PI) / 180
    return { hex: oklabToHex(l, c * Math.cos(rad), c * Math.sin(rad)), alpha: clamp(alpha) }
  }
  if (name === 'oklab') {
    const [l, a, b] = [num(parts[0] ?? ''), num(parts[1] ?? '', 0.4), num(parts[2] ?? '', 0.4)]
    if ([l, a, b].some(Number.isNaN)) return null
    return { hex: oklabToHex(l, a, b), alpha: clamp(alpha) }
  }
  return null
}

/** Perceptual lightness, 0 (black) to 1 (white). */
export function lightness(hex: string): number {
  return parseOklch(hexToOklch(hex))?.l ?? 0
}

/** A translucent colour as it shows over an opaque one, as hex. */
export function composite(top: Colour, under: string): string {
  if (top.alpha >= 0.999) return top.hex
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const mix = (i: number) => ch(top.hex, i) * top.alpha + ch(under, i) * (1 - top.alpha)
  return toHex(mix(0), mix(1), mix(2))
}

export interface ShadowStrength {
  present: boolean
  /** The darkest layer's opacity. */
  alpha: number
  /** The widest layer's blur, px. */
  blur: number
  /** The largest offset, px. */
  offset: number
}

/** Splits on commas outside brackets. */
function splitTop(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let at = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      out.push(text.slice(at, i))
      at = i + 1
    }
  }
  out.push(text.slice(at))
  return out.map((part) => part.trim()).filter(Boolean)
}

/** A box-shadow's strength: whether there is one, how dark and how wide its strongest layer is. */
export function shadowStrength(value: string | null | undefined): ShadowStrength {
  const none = { present: false, alpha: 0, blur: 0, offset: 0 }
  if (!value || value.trim() === 'none') return none
  let alpha = 0
  let blur = 0
  let offset = 0
  for (const layer of splitTop(value)) {
    if (/\binset\b/.test(layer)) continue
    const colourText = /(?:rgba?|oklch|oklab|color|hsla?)\([^)]*\)|#[\da-f]{3,8}\b/i.exec(layer)
    const colour = colourText ? parseCssColour(colourText[0]) : { hex: '#000000', alpha: 1 }
    const lengths = layer
      .replace(colourText?.[0] ?? '', '')
      .trim()
      .split(/\s+/)
      .map((p) => parseFloat(p))
      .filter((n) => !Number.isNaN(n))
    const [x = 0, y = 0, b = 0, spread = 0] = lengths
    // A layer that draws nothing: no colour, or no size at all.
    if (!colour || colour.alpha === 0 || (b === 0 && spread === 0 && x === 0 && y === 0)) continue
    alpha = Math.max(alpha, colour.alpha)
    blur = Math.max(blur, b)
    offset = Math.max(offset, Math.abs(x), Math.abs(y))
  }
  return { present: alpha > 0, alpha, blur, offset }
}

/** A length in px from a computed value, or null. */
export function px(value: string | null | undefined): number | null {
  if (!value) return null
  const n = parseFloat(value)
  return Number.isNaN(n) ? null : n
}

/** The shadows each named step draws. */
export const SHADOW_PRESETS = {
  none: 'none',
  subtle: '0 1px 2px rgb(0 0 0 / 0.06)',
  soft: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.08)',
  lifted: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  strong: '0 12px 28px -6px rgb(0 0 0 / 0.28), 0 4px 10px -4px rgb(0 0 0 / 0.16)',
} as const
