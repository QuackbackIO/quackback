function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(255, s * 255)))
}

function linearRgbToXyz(r: number, g: number, b: number): [number, number, number] {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ]
}

function xyzToLinearRgb(x: number, y: number, z: number): [number, number, number] {
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ]
}

function xyzToOklab(x: number, y: number, z: number): [number, number, number] {
  const l_ = 0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z
  const m_ = 0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z
  const s_ = 0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z

  const l = Math.cbrt(l_)
  const m = Math.cbrt(m_)
  const s = Math.cbrt(s_)

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToXyz(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  return [
    1.2270138511 * l - 0.5577999807 * m + 0.281256149 * s,
    -0.0405801784 * l + 1.1122568696 * m - 0.0716766787 * s,
    -0.0763812845 * l - 0.4214819784 * m + 1.5861632204 * s,
  ]
}

function oklabToOklch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b)
  let H = (Math.atan2(b, a) * 180) / Math.PI
  if (H < 0) H += 360
  return [L, C, H]
}

function oklchToOklab(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180
  return [L, C * Math.cos(hRad), C * Math.sin(hRad)]
}

export function hexToOklch(hex: string): string {
  let h = hex.replace('#', '')
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }

  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)

  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)

  const [x, y, z] = linearRgbToXyz(lr, lg, lb)
  const [L, a, ob] = xyzToOklab(x, y, z)
  const [oL, oC, oH] = oklabToOklch(L, a, ob)

  const lStr = oL.toFixed(3)
  const cStr = oC.toFixed(3)
  const hStr = oC < 0.001 ? '0' : oH.toFixed(0)

  return `oklch(${lStr} ${cStr} ${hStr})`
}

function rgbBytesToHex(r: number, g: number, b: number): string {
  const byte = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

function oklabToHex(L: number, a: number, b: number): string {
  const [x, y, z] = oklabToXyz(L, a, b)
  const [lr, lg, lb] = xyzToLinearRgb(x, y, z)
  return rgbBytesToHex(linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb))
}

export function oklchToHex(oklch: string): string {
  const match = oklch.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!match) return '#000000'

  const [oL, a, b] = oklchToOklab(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]))
  return oklabToHex(oL, a, b)
}

/**
 * The colour at an OKLCH lightness and hue as hex, its chroma lowered only as
 * far as it takes to sit inside sRGB. Clipping each channel instead would
 * turn the hue (a darkened yellow going orange), so a colour moved in
 * lightness keeps its hue this way.
 */
export function oklchToHexInGamut(L: number, C: number, H: number): string {
  const linear = (chroma: number) => {
    const [a, b] = oklchToOklab(L, chroma, H).slice(1) as [number, number]
    return xyzToLinearRgb(...oklabToXyz(L, a, b))
  }
  const fits = (chroma: number) => linear(chroma).every((c) => c >= -1e-4 && c <= 1 + 1e-4)
  let chroma = C
  if (!fits(chroma)) {
    let [low, high] = [0, C]
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2
      if (fits(mid)) low = mid
      else high = mid
    }
    chroma = low
  }
  return oklabToHex(...oklchToOklab(L, chroma, H))
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const f = (n: number) =>
    light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return rgbBytesToHex(f(0) * 255, f(8) * 255, f(4) * 255)
}

const CSS_NUMBER = /^-?(\d+\.?\d*|\.\d+)(%|deg)?$/

/** A CSS number token; `percentScale` is the value a trailing `%` of 100 maps to. */
function channel(token: string | undefined, percentScale: number): number | null {
  if (!token || !CSS_NUMBER.test(token)) return null
  const n = parseFloat(token)
  return token.endsWith('%') ? (n / 100) * percentScale : n
}

/** Parse hex, rgb(), hsl(), oklab() or oklch() into a lowercase 6-digit hex, or null. Alpha is dropped. */
function parseCssColorToHex(color: string): string | null {
  const value = color.trim().toLowerCase()

  const hex = value.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hex) {
    const h = hex[1].length <= 4 ? hex[1].replace(/./g, '$&$&') : hex[1]
    return `#${h.slice(0, 6)}`
  }

  const fn = value.match(/^(rgba?|hsla?|oklab|oklch)\(([^)]*)\)$/)
  if (!fn) return null
  const [a, b, c] = fn[2].split(/[\s,/]+/).filter(Boolean)

  let result: string | null = null
  if (fn[1].startsWith('rgb')) {
    const [r, g, bl] = [channel(a, 255), channel(b, 255), channel(c, 255)]
    if (r !== null && g !== null && bl !== null) result = rgbBytesToHex(r, g, bl)
  } else if (fn[1].startsWith('hsl')) {
    const [h, sat, l] = [channel(a, 360), channel(b, 100), channel(c, 100)]
    if (h !== null && sat !== null && l !== null) result = hslToHex(((h % 360) + 360) % 360, sat, l)
  } else if (fn[1] === 'oklab') {
    const [l, x, y] = [channel(a, 1), channel(b, 0.4), channel(c, 0.4)]
    if (l !== null && x !== null && y !== null) result = oklabToHex(l, x, y)
  } else {
    const [l, chroma, h] = [channel(a, 1), channel(b, 0.4), channel(c, 360)]
    if (l !== null && chroma !== null && h !== null) {
      result = oklabToHex(...oklchToOklab(l, chroma, h))
    }
  }
  // A channel like "1e999" parses to Infinity; reject rather than emit NaN.
  return result && !result.includes('NaN') ? result : null
}

/**
 * Convert any stored brand colour (hex, rgb(), hsl(), oklch(), oklab()) to a
 * lowercase 6-digit hex, for consumers that only accept hex (the SDK launcher).
 * Unparseable input falls back to '#000000'.
 */
export function cssColorToHex(color: string): string {
  return parseCssColorToHex(color) ?? '#000000'
}

/** Like `cssColorToHex`, but null (not black) when the colour cannot be parsed. */
export function tryCssColorToHex(color: string): string | null {
  return parseCssColorToHex(color)
}

/** Any supported colour as `oklch(L C H)`, or null when it cannot be parsed. */
export function cssColorToOklch(color: string): string | null {
  const hex = parseCssColorToHex(color)
  return hex ? hexToOklch(hex) : null
}

export function isValidHex(hex: string): boolean {
  return /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)
}

export function isValidOklch(oklch: string): boolean {
  return /^oklch\(\s*[\d.]+\s+[\d.]+\s+[\d.]+/.test(oklch)
}
