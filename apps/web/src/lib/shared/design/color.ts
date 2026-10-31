import { formatOklch } from '@/lib/shared/theme/expand'

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
