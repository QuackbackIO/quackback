/**
 * How the Font and shape section names a font and a corner radius, plain so
 * the server can build the Portal summary with the same words.
 */
import { FONT_OPTIONS } from '@/lib/shared/theme/font-options'
import { normalizeFontSans } from '@/lib/shared/theme/base'
import { fontDisplayName } from '@/lib/shared/theme/font-names'

/** Corner stops, in rem. */
export const CORNER_STOPS = [
  { value: '0', label: 'Sharp' },
  { value: '0.25', label: 'Slight' },
  { value: '0.5', label: 'Soft' },
  { value: '1', label: 'Round' },
] as const

/** The listed font a stack is, or null for a font outside the list. */
export function fontOptionOf(font: string) {
  return FONT_OPTIONS.find((f) => f.value === normalizeFontSans(font)) ?? null
}

/**
 * A font stack's first family, for a font outside the list ("Nunito"), as
 * words: a family named with no spaces reads Monzo Sans Text.
 */
export function fontFamilyName(font: string): string {
  const first =
    font
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? ''
  return first ? fontDisplayName(first) : 'System UI'
}

/** The font's name as the closed section shows it. */
export function fontName(font: string): string {
  return fontOptionOf(font)?.name ?? fontFamilyName(font)
}

/** The corner radius as the closed section and the summary show it. */
export function cornersName(rem: number): string {
  return CORNER_STOPS.find((stop) => Number(stop.value) === rem)?.label ?? `${rem}rem`
}
