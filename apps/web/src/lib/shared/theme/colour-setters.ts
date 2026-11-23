import { tryCssColorToHex } from './colors'
import { expandTheme, unbrandedTheme, type MinimalThemeVariables } from './expand'

export type ColourRole = 'primary' | 'background' | 'foreground' | 'header'
export type ColourMode = 'light' | 'dark'
type Palette = Partial<MinimalThemeVariables>

const LIGHT_FOREGROUND = '#0a0a0a'
const DARK_FOREGROUND = '#fafafa'
const LIGHT_MUTED_FOREGROUND = '#525252'
const DARK_MUTED_FOREGROUND = '#a1a1a1'

function channels(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** `amount` of `toward` mixed into `from`, per sRGB channel. */
function mix(from: string, toward: string, amount: number): string {
  const a = channels(from)
  const b = channels(toward)
  const out = a.map((c, i) => Math.round(c + (b[i]! - c) * amount))
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** The quiet fill (chips, avatars, the active tab) a background brings along. */
export function mutedOf(background: string): string {
  const dim = isDarkBackground(background)
  return mix(background, dim ? '#ffffff' : '#000000', dim ? 0.1 : 0.04)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(colour: string): number {
  const [r, g, b] = channels(colour).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const isDarkBackground = (background: string) => luminance(background) < 0.2

/** Hex of a stored colour in any supported format (hex, oklch, rgb, hsl), or null. */
const hexOf = (colour: string | undefined): string | null =>
  colour ? tryCssColorToHex(colour) : null

/** Same colour for our purposes: within 12 per channel, so oklch round trips match. */
export function sameColour(a: string | undefined, b: string): boolean {
  const x = hexOf(a)
  if (!x) return false
  const [p, q] = [channels(x), channels(b)]
  return p.every((c, i) => Math.abs(c - q[i]!) <= 12)
}

/** The text colour a background gets until the admin picks one. */
export const autoForeground = (background: string) =>
  isDarkBackground(background) ? DARK_FOREGROUND : LIGHT_FOREGROUND

/**
 * Whether a text colour is the automatic one for its background: as the
 * setters write it, or as the page shows it (moved to read at 4.5:1 where
 * it would not, which the editor's stylesheet then holds).
 */
function isAutoText(foreground: string | undefined, background: string, mode: ColourMode) {
  const auto = autoForeground(background)
  if (sameColour(foreground, auto)) return true
  const shown = hexOf(expandTheme({ background, foreground: auto }, { mode }).foreground)
  return shown !== null && sameColour(foreground, shown)
}

/**
 * The quiet text for a page: the usual grey, moved toward black or white only
 * as far as it takes to read on every surface it is drawn on (the page, its
 * card and its quiet fill). On the usual near-white and near-black pages the
 * usual grey already reads; on a coloured or mid-tone page it would not.
 */
function quietTextOn(surfaces: string[], dim: boolean): string {
  const usual = dim ? DARK_MUTED_FOREGROUND : LIGHT_MUTED_FOREGROUND
  const worst = (colour: string) =>
    Math.min(...surfaces.map((surface) => contrastRatio(colour, surface)))
  const toward = worst('#ffffff') > worst('#000000') ? '#ffffff' : '#000000'
  for (let step = 0; step <= 10; step++) {
    const colour = mix(usual, toward, step / 10)
    if (worst(colour) >= TEXT_CONTRAST) return colour
  }
  return toward
}

/** Dark primary follows the light one, except near-black, which would vanish. */
function autoDarkPrimary(lightPrimary: string): string {
  return luminance(lightPrimary) < 0.03 ? DARK_FOREGROUND : lightPrimary
}

/**
 * The palette with one colour changed and everything that follows from it
 * brought along. Stored colours may be in any supported format (older themes keep
 * oklch); they are compared as colours, and new values are written as hex.
 * A `hex` that cannot be parsed is a no-op: the palettes come back unchanged.
 *
 * Light and dark are independent, with one exception: setting the light
 * primary also moves the dark primary, but only while the dark primary is
 * still the automatic one (nothing was set for dark explicitly). A text colour
 * counts as automatic when it matches the automatic text for the old
 * background, so presets' near-black or near-white text flips with the page;
 * any other text colour is the admin's and survives background changes.
 */
export function applyColour(
  light: Palette,
  dark: Palette,
  role: ColourRole,
  mode: ColourMode,
  input: string
): { light: Palette; dark: Palette } {
  const hex = tryCssColorToHex(input)
  if (!hex) return { light, dark }
  const target = mode === 'light' ? light : dark
  const next: Palette = { ...target }

  if (role === 'foreground') {
    next.foreground = hex
  } else if (role === 'header') {
    next.header = hex
  } else if (role === 'primary') {
    next.primary = hex
  } else {
    const oldBackground = hexOf(target.background)
    const dim = isDarkBackground(hex)
    next.background = hex
    next.card = mix(hex, '#ffffff', dim ? 0.05 : 0.7)
    next.muted = mutedOf(hex)
    next.border = mix(hex, dim ? '#ffffff' : '#000000', dim ? 0.14 : 0.15)
    next.mutedForeground = quietTextOn([hex, next.card, next.muted], dim)
    if (
      !target.foreground ||
      (oldBackground && isAutoText(target.foreground, oldBackground, mode))
    ) {
      next.foreground = autoForeground(hex)
    }
  }

  const palettes = mode === 'light' ? { light: next, dark } : { light, dark: next }
  if (role === 'primary' && mode === 'light') {
    const oldLight = hexOf(light.primary)
    // The automatic one, as stored or as the dark page shows it (lightened to stand off it).
    const auto = oldLight === null ? null : autoDarkPrimary(oldLight)
    // The automatic one as the dark page shows it: lightened to stand off the
    // page, or darkened for white words on it (expandTheme).
    const shown = auto
      ? hexOf(expandTheme({ ...dark, primary: auto }, { mode: 'dark' }).primary)
      : null
    const wasAuto =
      !dark.primary ||
      (auto !== null && sameColour(dark.primary, auto)) ||
      (shown !== null && sameColour(dark.primary, shown))
    if (wasAuto) palettes.dark = { ...dark, primary: autoDarkPrimary(hex) }
  }
  return palettes
}

/** The palette keys a background brings along (see applyColour). */
const BACKGROUND_FAMILY = ['background', 'card', 'muted', 'border', 'mutedForeground'] as const

/**
 * The palette with one colour back on Auto: a background returns to the
 * unbranded one with everything that follows from it (and the text too, while
 * the text was the automatic one), a text colour follows its background again,
 * and the header is the page again.
 * The main colour has no Auto: it always has a value.
 */
export function resetColour(
  light: Palette,
  dark: Palette,
  role: Exclude<ColourRole, 'primary'>,
  mode: ColourMode
): { light: Palette; dark: Palette } {
  const target = mode === 'light' ? light : dark
  const unbranded = unbrandedTheme(mode)
  const next: Palette = { ...target }
  if (role === 'header') {
    delete next.header
  } else if (role === 'background') {
    for (const key of BACKGROUND_FAMILY) next[key] = unbranded[key]
    if (isAutoColour(target, 'foreground', mode)) next.foreground = unbranded.foreground
  } else {
    const background = hexOf(target.background) ?? hexOf(unbranded.background)!
    next.foreground = sameColour(unbranded.background, background)
      ? unbranded.foreground
      : autoForeground(background)
  }
  return mode === 'light' ? { light: next, dark } : { light, dark: next }
}

/**
 * Whether a palette's background or text is the automatic one: the unbranded
 * background, or the text its background gets until the admin picks one.
 */
export function isAutoColour(
  palette: Palette,
  role: Exclude<ColourRole, 'primary'>,
  mode: ColourMode
): boolean {
  if (role === 'header') return !hexOf(palette.header)
  const unbranded = unbrandedTheme(mode)
  const background = hexOf(palette.background) ?? hexOf(unbranded.background)!
  if (role === 'background') return sameColour(unbranded.background, background)
  if (!palette.foreground) return true
  return (
    isAutoText(palette.foreground, background, mode) ||
    (sameColour(unbranded.background, background) &&
      sameColour(palette.foreground, hexOf(unbranded.foreground)!))
  )
}

/** WCAG contrast ratio of two colours in any supported format, 1 to 21 (1 when unparseable). */
export function contrastRatio(a: string, b: string): number {
  const x = hexOf(a)
  const y = hexOf(b)
  if (!x || !y) return 1
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Body text reads at this contrast or more on what it sits on. */
export const TEXT_CONTRAST = 4.5

/** Hue (0 to 360), saturation and value (0 to 1) of a hex colour. */
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((c) => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return [(h * 60 + 360) % 360, max === 0 ? 0 : d / max, max]
}

/** The hex colour of a hue (0 to 360), saturation and value (0 to 1). */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
