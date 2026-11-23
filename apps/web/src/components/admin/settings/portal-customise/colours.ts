/**
 * The Colours section's rules: the warnings, the hex box and the swatches
 * the picker offers for each role.
 */
import { tryCssColorToHex } from '@/lib/shared/theme'
import {
  contrastRatio,
  LINK_CONTRAST,
  TEXT_CONTRAST,
  type ColourMode,
  type ColourRole,
} from '@/lib/shared/theme/colour-setters'
import type { Palette } from '@/components/admin/settings/branding/theme-css'

export type ColourWarning = 'links' | 'text'

/** What fails on a palette: links (main colour) under 3:1, text under 4.5:1. Empty when all reads. */
export function colourWarnings(palette: Palette): ColourWarning[] {
  const { primary, background, foreground } = palette
  if (!background) return []
  const warnings: ColourWarning[] = []
  if (primary && contrastRatio(primary, background) < LINK_CONTRAST) warnings.push('links')
  if (foreground && contrastRatio(foreground, background) < TEXT_CONTRAST) warnings.push('text')
  return warnings
}

/** A typed colour (`533AFD`, `#53f`, `rgb(83, 58, 253)` and so on) as hex, or null. */
export function parseColourInput(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  return tryCssColorToHex(value)
}

/** Hex for any stored colour, or the fallback. */
export const hexOrNull = (colour: string | undefined) => (colour ? tryCssColorToHex(colour) : null)

export interface Swatch {
  name: string
  hex: string
}

const MAIN: Swatch[] = [
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Pink', hex: '#db2777' },
  { name: 'Red', hex: '#e11d48' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Gold', hex: '#ca8a04' },
  { name: 'Green', hex: '#0e7c66' },
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Black', hex: '#171717' },
]

const BACKGROUND: Record<ColourMode, Swatch[]> = {
  light: [
    { name: 'White', hex: '#ffffff' },
    { name: 'Stone', hex: '#fafaf9' },
    { name: 'Warm', hex: '#f8f6f1' },
    { name: 'Cool', hex: '#f5f7fb' },
    { name: 'Mint', hex: '#f3f8f5' },
  ],
  dark: [
    { name: 'Black', hex: '#0a0a0a' },
    { name: 'Graphite', hex: '#111317' },
    { name: 'Night', hex: '#0b1220' },
  ],
}

const TEXT: Record<ColourMode, Swatch[]> = {
  light: [
    { name: 'Black', hex: '#0a0a0a' },
    { name: 'Ink', hex: '#111827' },
    { name: 'Slate', hex: '#334155' },
  ],
  dark: [
    { name: 'White', hex: '#fafafa' },
    { name: 'Mist', hex: '#e5e7eb' },
  ],
}

function mix(from: string, toward: string, amount: number): string {
  const ch = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [a, b] = [ch(from), ch(toward)]
  return `#${a
    .map((c, i) => Math.round(c + (b[i]! - c) * amount))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * The picker's swatches for a role: the site's colours first (from Import),
 * then the role's suggestions, a tint of the main colour for background and
 * text, ten at most and no repeats.
 */
export function roleSuggestions(
  role: ColourRole,
  mode: ColourMode,
  palette: Palette,
  siteColours: string[] = []
): Swatch[] {
  const primary = hexOrNull(palette.primary)
  let suggested: Swatch[]
  if (role === 'primary') suggested = MAIN
  else if (role === 'background') {
    suggested = [...BACKGROUND[mode]]
    if (primary) {
      suggested.push({
        name: 'Tinted',
        hex: mode === 'light' ? mix('#ffffff', primary, 0.05) : mix('#0a0a0a', primary, 0.08),
      })
    }
  } else if (role === 'header') {
    // The bar in the brand's colour, its ink, or a quiet dark one.
    suggested = [
      ...(primary ? [{ name: 'Main colour', hex: primary }] : []),
      { name: 'Black', hex: '#171717' },
      { name: 'Navy', hex: '#0b1f3a' },
      { name: 'White', hex: '#ffffff' },
    ]
  } else {
    suggested = [...TEXT[mode]]
    if (primary) {
      suggested.push({
        name: mode === 'light' ? 'Brand ink' : 'Tinted',
        hex: mode === 'light' ? mix(primary, '#000000', 0.75) : mix('#fafafa', primary, 0.15),
      })
    }
  }
  const site = siteColours.flatMap((colour) => {
    const hex = tryCssColorToHex(colour)
    return hex ? [{ name: 'From your site', hex }] : []
  })
  const seen = new Set<string>()
  return [...site, ...suggested]
    .filter((swatch) => !seen.has(swatch.hex) && seen.add(swatch.hex))
    .slice(0, 10)
}
