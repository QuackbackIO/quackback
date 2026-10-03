import { DEFAULT_LIGHT_BASE } from './theme/expand'

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

export function safeWebsiteBrandColor(value: string | null): string | null {
  const color = value ? normalizeHexColor(value) : null
  return color && hexContrastRatio(color, DEFAULT_LIGHT_BASE.foreground) >= 4.5 ? color : null
}
