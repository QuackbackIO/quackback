/**
 * Color conversion utilities for hex <-> OKLCH
 *
 * Based on the OKLCH color space specification.
 * All math is pure with no external dependencies.
 */

/**
 * Convert sRGB component (0-255) to linear RGB
 */
function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/**
 * Convert linear RGB to sRGB component (0-255)
 */
function linearToSrgb(c: number): number {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(255, s * 255)))
}

/**
 * Convert linear RGB to XYZ (D65)
 */
function linearRgbToXyz(r: number, g: number, b: number): [number, number, number] {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ]
}

/**
 * Convert XYZ to linear RGB
 */
function xyzToLinearRgb(x: number, y: number, z: number): [number, number, number] {
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ]
}

/**
 * Convert XYZ to OKLAB
 */
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

/**
 * Convert OKLAB to XYZ
 */
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

/**
 * Convert OKLAB to OKLCH
 */
function oklabToOklch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b)
  let H = (Math.atan2(b, a) * 180) / Math.PI
  if (H < 0) H += 360
  return [L, C, H]
}

/**
 * Convert OKLCH to OKLAB
 */
function oklchToOklab(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180
  return [L, C * Math.cos(hRad), C * Math.sin(hRad)]
}

/**
 * Convert hex color (#rrggbb or #rgb) to OKLCH string
 *
 * @param hex - Hex color string (with or without #)
 * @returns OKLCH string in format "oklch(L C H)"
 */
export function hexToOklch(hex: string): string {
  // Normalize hex
  let h = hex.replace('#', '')
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }

  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)

  // sRGB -> linear RGB
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)

  // linear RGB -> XYZ
  const [x, y, z] = linearRgbToXyz(lr, lg, lb)

  // XYZ -> OKLAB
  const [L, a, ob] = xyzToOklab(x, y, z)

  // OKLAB -> OKLCH
  const [oL, oC, oH] = oklabToOklch(L, a, ob)

  // Format with reasonable precision
  const lStr = oL.toFixed(3)
  const cStr = oC.toFixed(3)
  const hStr = oC < 0.001 ? '0' : oH.toFixed(0) // No hue for near-gray colors

  return `oklch(${lStr} ${cStr} ${hStr})`
}

/**
 * Convert OKLCH string to hex color
 *
 * @param oklch - OKLCH string in format "oklch(L C H)" or "oklch(L C H / A)"
 * @returns Hex color string with # prefix
 */
export function oklchToHex(oklch: string): string {
  // Parse OKLCH string
  const match = oklch.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!match) {
    return '#000000'
  }

  const L = parseFloat(match[1])
  const C = parseFloat(match[2])
  const H = parseFloat(match[3])

  // OKLCH -> OKLAB
  const [oL, a, b] = oklchToOklab(L, C, H)

  // OKLAB -> XYZ
  const [x, y, z] = oklabToXyz(oL, a, b)

  // XYZ -> linear RGB
  const [lr, lg, lb] = xyzToLinearRgb(x, y, z)

  // linear RGB -> sRGB
  const r = linearToSrgb(lr)
  const g = linearToSrgb(lg)
  const b_ = linearToSrgb(lb)

  // Format as hex
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b_)}`
}

/**
 * Check if a string is a valid hex color
 */
export function isValidHex(hex: string): boolean {
  return /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)
}

/**
 * Check if a string is a valid OKLCH color
 */
export function isValidOklch(oklch: string): boolean {
  return /^oklch\(\s*[\d.]+\s+[\d.]+\s+[\d.]+/.test(oklch)
}
