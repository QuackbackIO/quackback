import { formatOklch, parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch, oklchToHex } from '@/lib/shared/theme/colors'

const HEX = /^#([\da-f]{3}|[\da-f]{6})$/i
const RGB = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/i
const HSL =
  /^hsla?\(\s*(\d+(?:\.\d+)?)(?:deg)?\s*[,\s]\s*(\d+(?:\.\d+)?)%\s*[,\s]\s*(\d+(?:\.\d+)?)%\s*\)$/i
const OKLCH = /^oklch\(\s*(\d+(?:\.\d+)?%?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\)$/i

function toHex(r: number, g: number, b: number): string | null {
  if ([r, g, b].some((c) => c < 0 || c > 255)) return null
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

function hslToHex(h: number, s: number, l: number): string | null {
  if (s > 100 || l > 100) return null
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const channel = (n: number) =>
    255 * (light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))
  return toHex(channel(0), channel(8), channel(4))
}

/**
 * A colour a design may store, in one canonical form: hex, rgb() and hsl()
 * become six-digit lowercase hex, and oklch() keeps its space in a fixed
 * format. Anything else (named colours, variables, translucent colours) is
 * refused with null, because the contrast solver must know the exact colour.
 */
export function normaliseColor(value: string): string | null {
  const color = value.trim()
  const hex = HEX.exec(color)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1]
    return `#${digits.toLowerCase()}`
  }
  const rgb = RGB.exec(color)
  if (rgb) return toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))
  const hsl = HSL.exec(color)
  if (hsl) return hslToHex(Number(hsl[1]) % 360, Number(hsl[2]), Number(hsl[3]))
  const oklch = OKLCH.exec(color)
  if (oklch) {
    const l = oklch[1].endsWith('%') ? parseFloat(oklch[1]) / 100 : parseFloat(oklch[1])
    if (l > 1) return null
    return formatOklch(l, parseFloat(oklch[2]), parseFloat(oklch[3]))
  }
  return null
}

/**
 * `a` mixed into `b` in oklab, `weight` being a's share, as hex so a derived
 * colour compares exactly with a stored one. Takes hex or oklch().
 */
export function mixColor(a: string, b: string, weight: number): string {
  const lab = (color: string) => {
    const parsed = parseOklch(color.startsWith('#') ? hexToOklch(color) : color)
    if (!parsed) throw new Error(`Cannot mix "${color}"`)
    const radians = (parsed.h * Math.PI) / 180
    return { l: parsed.l, a: parsed.c * Math.cos(radians), b: parsed.c * Math.sin(radians) }
  }
  const x = lab(a)
  const y = lab(b)
  const mix = (p: number, q: number) => p * weight + q * (1 - weight)
  const l = mix(x.l, y.l)
  const da = mix(x.a, y.a)
  const db = mix(x.b, y.b)
  const c = Math.hypot(da, db)
  const h = c < 1e-6 ? 0 : ((Math.atan2(db, da) * 180) / Math.PI + 360) % 360
  return oklchToHex(formatOklch(l, c, h))
}

/**
 * A pale tone of a colour for a surface near a page: the page's lightness,
 * stepped toward the middle by `depth`, in the colour's own hue with a little
 * of its chroma. Unlike a mix, a deep colour over a warm page stays its hue
 * rather than turning grey.
 */
export function tintOf(color: string, page: string, depth: number): string {
  const parse = (value: string) => parseOklch(value.startsWith('#') ? hexToOklch(value) : value)
  const own = parse(color)
  const ground = parse(page)
  if (!own || !ground) return mixColor(color, page, depth * 2)
  const l = ground.l > 0.5 ? ground.l - depth : ground.l + depth
  return oklchToHex(formatOklch(l, Math.min(own.c * 0.5, 0.07), own.h))
}
