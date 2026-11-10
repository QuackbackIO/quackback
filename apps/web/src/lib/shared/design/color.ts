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
 * Below this chroma a colour the browser converts into oklch (hex, rgb()) has
 * no hue, so a mix takes the other colour's: Chromium's rule, measured.
 */
const HUELESS = 0.02

/**
 * `a` mixed into `b` as `color-mix(in oklch, a <weight>, b)` draws it:
 * lightness and chroma run straight, hue the shorter way round, a hueless
 * colour taking the other's hue. As hex, so it measures as painted.
 */
export function mixOklch(a: string, b: string, weight: number): string {
  const read = (color: string) => {
    const parsed = parseOklch(color.startsWith('#') ? hexToOklch(color) : color)
    if (!parsed) throw new Error(`Cannot mix "${color}"`)
    return { ...parsed, hueless: color.startsWith('#') && parsed.c < HUELESS }
  }
  const [x, y] = [read(a), read(b)]
  const mix = (p: number, q: number) => p * weight + q * (1 - weight)
  const turn = ((y.h - x.h + 540) % 360) - 180
  const h = x.hueless ? y.h : y.hueless ? x.h : (x.h + turn * (1 - weight) + 360) % 360
  return oklchToHex(formatOklch(mix(x.l, y.l), mix(x.c, y.c), h))
}

export type Lch = { l: number; c: number; h: number }

export function lchOf(color: string): Lch {
  const parsed = parseOklch(color.startsWith('#') ? hexToOklch(color) : color)
  if (!parsed) throw new Error(`Cannot read "${color}"`)
  return parsed
}

/** How far apart two colours are in oklab: 0 for one colour, about 0.02 for a just visible step. */
export function oklabDistance(a: string, b: string): number {
  const lab = (color: string) => {
    const { l, c, h } = lchOf(color)
    const radians = (h * Math.PI) / 180
    return [l, c * Math.cos(radians), c * Math.sin(radians)]
  }
  const [x, y] = [lab(a), lab(b)]
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!)
}

/** Whether an oklch colour is one a screen shows, as linear sRGB in [0, 1]. */
function shown({ l, c, h }: Lch): boolean {
  const radians = (h * Math.PI) / 180
  const [a, b] = [c * Math.cos(radians), c * Math.sin(radians)]
  const lms = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map((v) => v ** 3) as [number, number, number]
  const [x, y, z] = lms
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ].every((v) => v >= -0.0005 && v <= 1.0005)
}

/** The colour as hex, giving up chroma (never hue or lightness) until a screen shows it. */
export function fitted(colour: Lch): string {
  let { c } = colour
  if (!shown(colour)) {
    let [low, high] = [0, c]
    for (let step = 0; step < 20; step++) {
      const mid = (low + high) / 2
      if (shown({ ...colour, c: mid })) low = mid
      else high = mid
    }
    c = low
  }
  return oklchToHex(formatOklch(Math.max(0, Math.min(1, colour.l)), c, colour.h))
}

/** Below this chroma a colour reads as a grey, its hue meaningless. */
const NEUTRAL = 0.02

/**
 * Past this many degrees apart two hues are opposites, with no hue between
 * them that belongs to either: a straight mix of a lime and a violet turns
 * a sky blue.
 */
const OPPOSITE = 150

/**
 * Two colours mixed without the grey between them: the hue and lightness a
 * straight (oklab) mix gives, which leans to the more vivid of the two, at
 * the chroma running evenly between theirs. Where a straight mix of a blue
 * and an orange meets in a grey, this keeps the colour of both, a magenta.
 * Two opposite hues meet in the more vivid one's hue instead, so the blend
 * never shows a third colour neither brand colour is. A grey (no hue)
 * mixes as a straight mix does.
 */
export function blendHue(a: string, b: string, weight: number): string {
  if (weight >= 1) return normaliseColor(a) ?? a
  if (weight <= 0) return normaliseColor(b) ?? b
  const [x, y] = [lchOf(a), lchOf(b)]
  const straight = mixColor(a, b, weight)
  if (x.c < NEUTRAL || y.c < NEUTRAL) return straight
  const { l, h } = lchOf(straight)
  const apart = Math.abs(((x.h - y.h + 540) % 360) - 180)
  const hue = apart > OPPOSITE ? (x.c >= y.c ? x.h : y.h) : h
  return fitted({ l, c: y.c + (x.c - y.c) * weight, h: hue })
}

/**
 * A colour moved toward a page by its lightness alone: a share of 1 is the
 * colour, 0 the page's lightness. Over a neutral page it keeps its own hue
 * and as much of its chroma as the screen shows at that lightness, so a
 * deep colour veiled for words to read on comes out a clear lighter tone
 * of itself, not the greyed one a mix toward white or black gives. Over a
 * coloured page it runs into the page's colour without greying (blendHue).
 */
export function liftToward(colour: string, page: string, share: number): string {
  if (share >= 1) return normaliseColor(colour) ?? colour
  if (share <= 0) return normaliseColor(page) ?? page
  const [own, ground] = [lchOf(colour), lchOf(page)]
  if (ground.c >= NEUTRAL) return blendHue(colour, page, share)
  return fitted({ l: ground.l + (own.l - ground.l) * share, c: own.c, h: own.h })
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
