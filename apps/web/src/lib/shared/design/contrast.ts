import { hexToOklch, oklchToHex } from '@/lib/shared/theme/colors'
import { formatOklch, parseOklch } from '@/lib/shared/theme/expand'

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

/** `color` at `alpha` over `under`, as the browser blends it, in hex. */
export function overlay(color: string, under: string, alpha: number): string {
  const { r, g, b } = over({ ...parseColor(color), a: alpha }, parseColor(under))
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
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

const STEP = 0.005

function toOklch(color: string): { l: number; c: number; h: number } {
  const parsed = parseOklch(color.startsWith('#') ? hexToOklch(color) : color)
  if (!parsed) throw new Error(`Cannot adjust "${color}"`)
  return parsed
}

const lowest = (color: string, backgrounds: string[]) =>
  Math.min(...backgrounds.map((bg) => contrastRatio(color, bg)))

/**
 * The colour nearest to `color` in lightness that reaches `target` against
 * every background, keeping its chroma and hue. Null when none does.
 */
export function solveContrast(color: string, backgrounds: string[], target: number): string | null {
  if (lowest(color, backgrounds) >= target) return color
  const { l, c, h } = toOklch(color)
  // Darker against light backgrounds, lighter against dark ones.
  const direction =
    contrastRatio(backgrounds[0], '#000000') > contrastRatio(backgrounds[0], '#ffffff') ? -1 : 1
  for (let next = l + direction * STEP; next >= 0 && next <= 1; next += direction * STEP) {
    const candidate = formatOklch(next, c, h)
    if (lowest(candidate, backgrounds) >= target) return candidate
  }
  return null
}

/** APCA's screen luminance: sRGB at a simple 2.4 power, soft-clamped near black. */
function apcaLuminance({ r, g, b }: Rgba): number {
  const y =
    0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4
  return y < 0.022 ? y + (0.022 - y) ** 1.414 : y
}

/**
 * The APCA lightness contrast (Lc, version 0.0.98G) of text on a background:
 * about 0 to 106 for dark text on light, about 0 to -108 for light text on
 * dark. It weighs how text reads by its polarity, where WCAG 2's ratio
 * favours black on mid-dark saturated colours that white reads clearer on.
 */
export function apcaContrast(text: string, background: string): number {
  const bg = parseColor(background)
  const yBg = apcaLuminance(bg)
  const yText = apcaLuminance(over(parseColor(text), bg))
  if (Math.abs(yBg - yText) < 0.0005) return 0
  if (yBg > yText) {
    const lc = (yBg ** 0.56 - yText ** 0.57) * 1.14
    return lc < 0.1 ? 0 : (lc - 0.027) * 100
  }
  const lc = (yBg ** 0.65 - yText ** 0.62) * 1.14
  return lc > -0.1 ? 0 : (lc + 0.027) * 100
}

/** Whether a colour is light: black reads on it better than white, by WCAG 2. */
export const isLight = (color: string) =>
  contrastRatio(color, '#000000') > contrastRatio(color, '#ffffff')
const weakestLc = (ink: string, backgrounds: string[]) =>
  Math.min(...backgrounds.map((bg) => Math.abs(apcaContrast(ink, bg))))

/**
 * Text for a fill, given an ink that reaches `target` on every background:
 * where the first of `others` on the far side of light from it reaches the
 * target too and reads clearer by APCA, that one; else the ink itself. So
 * where both black and white pass, the one that reads better wins, and an
 * ink only one side passes with stays.
 */
export function clearerInk(
  ink: string,
  backgrounds: string[],
  others: string[],
  target = 4.5
): string {
  const light = isLight(ink)
  const other = others.find(
    (o) => isLight(o) !== light && backgrounds.every((bg) => contrastRatio(o, bg) >= target)
  )
  return other && weakestLc(other, backgrounds) > weakestLc(ink, backgrounds) ? other : ink
}
