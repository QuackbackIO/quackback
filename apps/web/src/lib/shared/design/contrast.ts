import { oklchToHex } from '@/lib/shared/theme/colors'

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const HEX = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i
const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i

function fraction(value: string): number {
  return value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value)
}

function hexToRgba(hex: string): Rgba {
  const digits = hex.slice(1)
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits
  const channel = (i: number) => parseInt(full.slice(i, i + 2), 16)
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: full.length === 8 ? channel(6) / 255 : 1,
  }
}

/** The sRGB colour and alpha of a hex or oklch() value, the forms the theme writes. */
function parseColor(color: string): Rgba {
  const value = color.trim()
  if (HEX.test(value)) return hexToRgba(value)
  const match = OKLCH.exec(value)
  if (match) {
    const [, l, c, h, alpha] = match
    const rgb = hexToRgba(oklchToHex(`oklch(${fraction(l)} ${c} ${h})`))
    return { ...rgb, a: alpha === undefined ? 1 : fraction(alpha) }
  }
  throw new Error(`Cannot measure the contrast of "${color}"`)
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** A translucent colour as it shows over an opaque one. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => Math.round(t * top.a + b * (1 - top.a))
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 }
}

/**
 * The WCAG 2.x contrast ratio of a colour shown on a background, from 1 to 21.
 * A translucent foreground is measured as it shows over the background.
 */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background)
  const fg = over(parseColor(foreground), bg)
  const [lighter, darker] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}
