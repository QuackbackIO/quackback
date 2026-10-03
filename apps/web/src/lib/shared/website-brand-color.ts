import { hexToOklch } from './theme/colors'
import { parseOklch } from './theme/expand'

/** Website metadata supports opaque three-digit and six-digit hex colors. */
export function normalizeHexColor(value: string): string | null {
  const color = value.trim()
  if (/^#[\da-f]{6}$/i.test(color)) return color.toUpperCase()
  if (/^#[\da-f]{3}$/i.test(color))
    return ('#' + [...color.slice(1)].map((digit) => digit + digit).join('')).toUpperCase()
  return null
}

function luminance(color: string): number {
  const hex = normalizeHexColor(color)
  if (!hex) return NaN
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function hexContrastRatio(first: string, second: string): number {
  const a = luminance(first),
    b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The primary fill carries white text, so the color needs at least 3:1 against white. */
const MIN_CONTRAST_WITH_WHITE = 3
/** Below this OKLCH chroma a color reads as black, grey or slate rather than a brand. */
const MIN_CHROMA = 0.05

export function safeWebsiteBrandColor(value: string | null): string | null {
  const color = value ? normalizeHexColor(value) : null
  if (!color || hexContrastRatio(color, '#FFFFFF') < MIN_CONTRAST_WITH_WHITE) return null
  const chroma = parseOklch(hexToOklch(color))?.c ?? 0
  return chroma >= MIN_CHROMA ? color : null
}
