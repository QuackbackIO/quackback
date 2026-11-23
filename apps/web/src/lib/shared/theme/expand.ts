import { cssColorToOklch, oklchToHex, tryCssColorToHex } from './colors'
import type { ThemeVariables } from './types'

export interface MinimalThemeVariables {
  primary: string
  background: string
  foreground: string
  card: string
  muted: string
  mutedForeground: string
  border: string
  destructive: string
  success: string
  ring?: string
  fontSans?: string
  /** The font titles and headings are set in. Unset, the text font. */
  fontHeading?: string
  radius?: string
  /** Explicit secondary color - falls back to muted if not provided */
  secondary?: string
  /** Explicit accent color - falls back to muted if not provided */
  accent?: string
  /** The header bar's colour. Unset, the header is the page. */
  header?: string
}

export interface MinimalThemeConfig {
  light?: MinimalThemeVariables
  dark?: MinimalThemeVariables
}

/** The variables an expansion cannot do without; the rest derive from these. */
type ThemeColorBase = Omit<
  MinimalThemeVariables,
  'ring' | 'secondary' | 'accent' | 'fontSans' | 'fontHeading' | 'radius'
>

/**
 * Palette used for any variable a theme leaves out. globals.css
 * ships these same values as the un-branded defaults, so filling a gap emits
 * the value the page would otherwise have inherited. The `default` preset is
 * built from these same constants, which keeps the two from drifting apart.
 */
export const DEFAULT_LIGHT_BASE: ThemeColorBase = {
  primary: 'oklch(0.886 0.176 86)',
  background: '#ffffff',
  foreground: '#0a0a0a',
  card: '#ffffff',
  muted: '#f5f5f5',
  mutedForeground: '#525252',
  border: '#d4d4d4',
  destructive: 'oklch(0.577 0.245 27)',
  success: 'oklch(0.49 0.115 165.6)',
}

export const DEFAULT_DARK_BASE: ThemeColorBase = {
  primary: 'oklch(0.886 0.176 86)',
  background: '#0a0a0a',
  foreground: '#fafafa',
  card: '#0f0f0f',
  muted: '#222222',
  mutedForeground: '#a1a1a1',
  border: '#262626',
  destructive: 'oklch(0.70 0.19 25)',
  success: 'oklch(0.696 0.149 163)',
}

/**
 * The font an unbranded page renders in: globals.css's --font-sans, led by the
 * Inter it self-hosts (@fontsource-variable/inter names it "Inter Variable").
 */
export const DEFAULT_FONT_SANS = '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif'

/**
 * What a side with no headings font writes when the other side has one: the
 * variable made empty, so headings there fall back to the text font where
 * they are drawn (`var(--font-heading, var(--font-sans))`).
 */
export const NO_HEADING_FONT = 'initial'

/** The corner radius globals.css ships. */
export const DEFAULT_RADIUS = '0.5rem'

function basePalette(mode: 'light' | 'dark'): ThemeColorBase {
  return mode === 'light' ? DEFAULT_LIGHT_BASE : DEFAULT_DARK_BASE
}

/**
 * The theme an unbranded workspace renders, as the variables a saved theme
 * holds: the palette, radius and font a visitor sees before anything is
 * customised. The branding editor starts from it, so saving a theme nobody
 * touched stores what visitors already see.
 */
export function unbrandedTheme(mode: 'light' | 'dark'): MinimalThemeVariables {
  return {
    ...basePalette(mode),
    fontSans: DEFAULT_FONT_SANS,
    radius: DEFAULT_RADIUS,
  }
}

/** Every variable a theme may carry. Anything else on the object is derived. */
export const MINIMAL_THEME_VARIABLE_KEYS = [
  'primary',
  'background',
  'foreground',
  'card',
  'muted',
  'mutedForeground',
  'border',
  'destructive',
  'success',
  'ring',
  'secondary',
  'accent',
  'header',
  'fontSans',
  'fontHeading',
  'radius',
] as const

/**
 * Fill the gaps in a theme with the base palette for that mode.
 *
 * Branding is stored as a loose JSON blob written one variable at a time, so a
 * workspace that picks a brand colour and stops saves `{ primary }` and nothing
 * else — an ordinary shape the expander has to survive. Only a usable value
 * counts as a choice: an absent key, a null (JSON's way of carrying "cleared")
 * and an empty string all fall through to the base, while anything the
 * workspace did set is passed on untouched.
 */
function resolveMinimal(
  minimal: Partial<MinimalThemeVariables>,
  mode: 'light' | 'dark'
): MinimalThemeVariables {
  const resolved: MinimalThemeVariables = { ...basePalette(mode) }
  for (const key of MINIMAL_THEME_VARIABLE_KEYS) {
    const value = minimal[key]
    if (typeof value === 'string' && value.trim() !== '') resolved[key] = value
  }
  // A header written as the page's own (the other side's stand-in) is unset.
  if (resolved.header && !tryCssColorToHex(resolved.header)) delete resolved.header
  // So is a headings font written as `initial`.
  if (resolved.fontHeading === NO_HEADING_FONT) delete resolved.fontHeading
  if (!(typeof minimal.radius === 'string' && minimal.radius.trim())) {
    resolved.radius = DEFAULT_RADIUS
  }
  return resolved
}

const LIGHT_SHADOWS = {
  shadow2xs: '0 0 0 0 transparent',
  shadowXs: '0 0 0 0 transparent',
  shadowSm: '0 0 0 1px oklch(0 0 0 / 0.04)',
  shadow: '0 0 0 1px oklch(0 0 0 / 0.06)',
  shadowMd: '0 4px 16px oklch(0 0 0 / 0.08)',
  shadowLg: '0 8px 24px oklch(0 0 0 / 0.1)',
  shadowXl: '0 12px 32px oklch(0 0 0 / 0.12)',
  shadow2xl: '0 16px 40px oklch(0 0 0 / 0.16)',
}

const DARK_SHADOWS = {
  shadow2xs: '0 0 0 0 transparent',
  shadowXs: '0 0 0 0 transparent',
  shadowSm: '0 0 0 1px oklch(1 0 0 / 0.06)',
  shadow: '0 0 0 1px oklch(1 0 0 / 0.08)',
  shadowMd: '0 8px 24px oklch(0 0 0 / 0.4)',
  shadowLg: '0 12px 32px oklch(0 0 0 / 0.5)',
  shadowXl: '0 16px 40px oklch(0 0 0 / 0.55)',
  shadow2xl: '0 20px 48px oklch(0 0 0 / 0.6)',
}

export function parseOklch(oklch: string): { l: number; c: number; h: number } | null {
  const pattern = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/
  // Hex, rgb() and hsl() brand colours are read through their oklch equivalent.
  const match = oklch.match(pattern) ?? cssColorToOklch(oklch)?.match(pattern)
  if (!match) return null
  return { l: parseFloat(match[1]), c: parseFloat(match[2]), h: parseFloat(match[3]) }
}

export function formatOklch(l: number, c: number, h: number): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(0)})`
}

export function adjustHue(oklch: string, degrees: number): string {
  const parsed = parseOklch(oklch)
  if (!parsed) return oklch
  return formatOklch(parsed.l, parsed.c, (parsed.h + degrees + 360) % 360)
}

export function computeContrastForeground(bgOklch: string): string {
  const parsed = parseOklch(bgOklch)
  if (!parsed) return 'oklch(0.985 0 0)'
  return parsed.l > 0.6 ? 'oklch(0.145 0 0)' : 'oklch(0.985 0 0)'
}

/** Gold-as-fill stays bright; on light surfaces, type/icons step down in
 *  lightness only. Keep chroma/hue so it still reads yellow, not olive. */
export function computeAccentInk(primary: string, mode: 'light' | 'dark'): string {
  if (mode === 'dark') return primary
  const parsed = parseOklch(primary)
  if (!parsed) return primary
  if (parsed.l <= 0.75) return primary
  return formatOklch(0.72, parsed.c, parsed.h)
}

export function generateChartColors(primary: string): [string, string, string, string, string] {
  const parsed = parseOklch(primary)
  if (!parsed) {
    return [
      'oklch(0.886 0.176 86)',
      'oklch(0.696 0.149 163)',
      'oklch(0.769 0.165 70)',
      'oklch(0.645 0.215 16)',
      'oklch(0.606 0.219 293)',
    ]
  }

  const { l, c, h } = parsed
  const goldenAngle = 137.5

  return [
    primary,
    formatOklch(l, c, (h + goldenAngle) % 360),
    formatOklch(l, c, (h + goldenAngle * 2) % 360),
    formatOklch(l, c, (h + goldenAngle * 3) % 360),
    formatOklch(l, c, (h + goldenAngle * 4) % 360),
  ]
}

/**
 * Expand a theme into the full variable set. The input is whatever the
 * workspace saved, complete or not: gaps resolve to the base palette first, so
 * every variable read below is a real value.
 */
export function expandTheme(
  partial: Partial<MinimalThemeVariables>,
  options: { mode: 'light' | 'dark' }
): ThemeVariables {
  const resolved = resolveMinimal(partial, options.mode)
  // In dark mode a main colour too dark to show on the page is lightened.
  const shown =
    options.mode === 'dark' ? darkMainColour(resolved.primary, resolved.background) : null
  const minimal = shown ? { ...resolved, primary: shown.primary } : resolved
  const shadows = options.mode === 'light' ? LIGHT_SHADOWS : DARK_SHADOWS
  const primaryForeground = shown?.foreground ?? readableInkOn(minimal.primary)
  const destructiveForeground = computeContrastForeground(minimal.destructive)
  const accentInk = computeAccentInk(minimal.primary, options.mode)
  const charts = generateChartColors(minimal.primary)

  return {
    primary: minimal.primary,
    accentInk,
    background: minimal.background,
    foreground: minimal.foreground,
    card: minimal.card,
    muted: minimal.muted,
    mutedForeground: minimal.mutedForeground,
    border: minimal.border,
    destructive: minimal.destructive,
    success: minimal.success,
    primaryForeground,
    // Focus stays neutral. A ring that only repeats the brand colour is the
    // default this replaced, not a choice, so it reads as unset.
    ring: minimal.ring && minimal.ring !== minimal.primary ? minimal.ring : minimal.mutedForeground,
    cardForeground: minimal.foreground,
    popover: minimal.card,
    popoverForeground: minimal.foreground,
    secondary: minimal.secondary ?? minimal.muted,
    secondaryForeground: minimal.foreground,
    accent: minimal.accent ?? minimal.muted,
    accentForeground: minimal.foreground,
    input: minimal.border,
    destructiveForeground,
    chart1: charts[0],
    chart2: charts[1],
    chart3: charts[2],
    chart4: charts[3],
    chart5: charts[4],
    fontSans: minimal.fontSans,
    ...(minimal.fontHeading ? { fontHeading: minimal.fontHeading } : {}),
    radius: minimal.radius,
    ...headerOf(minimal, primaryForeground),
    ...shadows,
  }
}

/** A filled button stands off the page at this contrast or more (WCAG 1.4.11). */
const BUTTON_SHOWS = 3
/** The words on a filled button read at this contrast or more in their usual ink. */
const BUTTON_TEXT_CONTRAST = 4.5
/**
 * White words on a filled button stay white at this contrast or more (WCAG's
 * large or bold text threshold): brand buttons in mid-tone teals, greens and
 * indigos keep the white text they were designed with.
 */
const BUTTON_WHITE_TEXT_CONTRAST = 3
const LIGHT_INK = 'oklch(0.985 0 0)'
const DARK_INK = 'oklch(0.145 0 0)'

/**
 * A main colour for a dark page, when the one given would not show on it: a
 * navy button on near-black is there, and cannot be seen. The colour is
 * lightened (OKLCH lightness, same hue and chroma) only as far as it takes
 * for a filled button to stand off the page, and for white or near-black
 * words to read on it. Null when the colour already shows, or either colour
 * cannot be read: nothing is changed then.
 */
export function darkMainColour(
  primary: string,
  background: string
): { primary: string; foreground: string } | null {
  const page = tryCssColorToHex(background)
  const from = tryCssColorToHex(primary)
  const lch = parseOklch(primary)
  if (!page || !from || !lch) return null
  if (contrastOf(from, page) >= BUTTON_SHOWS) return null
  // Only a colour darker than it needs to be: a pale one on a pale "dark" page is not this rule's.
  if (relativeLuminance(from) > relativeLuminance(page) && relativeLuminance(page) > 0.2)
    return null
  for (let l = Math.ceil(lch.l * 100) / 100; l <= 1.0001; l += 0.01) {
    const candidate = formatOklch(Math.min(1, l), lch.c, lch.h)
    let hex: string
    try {
      hex = oklchToHex(candidate)
    } catch {
      continue
    }
    if (relativeLuminance(hex) <= relativeLuminance(page)) continue
    if (contrastOf(hex, page) < BUTTON_SHOWS) continue
    // Lightened until white or near-black reads at 4.5:1; the words on it
    // then follow the rule every filled button does.
    const reads = (ink: string) => contrastOf(oklchToHex(ink), hex) >= BUTTON_TEXT_CONTRAST
    if (reads(LIGHT_INK) || reads(DARK_INK))
      return { primary: candidate, foreground: readableInkOn(candidate) }
  }
  return null
}

/**
 * The ink for words on a fill: the usual one (near-white on a dark fill,
 * near-black on a light one) where it reads at 4.5:1, or near-black's full
 * strength on a light fill. Otherwise white, wherever pure white reaches 3:1:
 * a teal or indigo button keeps its white words rather than turning black.
 * Only under that do the words turn dark, and if nothing reads, the ink that
 * reads best is used.
 */
function readableInkOn(fill: string): string {
  const usual = computeContrastForeground(fill)
  const hex = tryCssColorToHex(fill)
  if (!hex) return usual
  const contrast = (ink: string) => contrastOf(tryCssColorToHex(ink) ?? oklchToHex(ink), hex)
  if (contrast(usual) >= BUTTON_TEXT_CONTRAST) return usual
  if (usual === DARK_INK && contrast('#000000') >= BUTTON_TEXT_CONTRAST) return '#000000'
  if (contrast('#ffffff') >= BUTTON_WHITE_TEXT_CONTRAST) return '#ffffff'
  const dark = [DARK_INK, '#000000'].find((ink) => contrast(ink) >= BUTTON_TEXT_CONTRAST)
  if (dark) return dark
  return contrast('#ffffff') >= contrast('#000000') ? '#ffffff' : '#000000'
}

/** Text on the header bar reads at this contrast or more, as body text does. */
const HEADER_TEXT_CONTRAST = 4.5
/** The main button shows on the bar at this contrast or more; under it, it is turned over. */
const HEADER_BUTTON_CONTRAST = 3

/** WCAG relative luminance of a 6-digit hex colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two 6-digit hex colours, 1 to 21. */
export function contrastOf(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

/** The CSS a header bar of the page's own colour has: what globals.css sets. */
export const PAGE_HEADER: Readonly<Partial<ThemeVariables>> = {
  header: 'var(--background)',
  headerForeground: 'var(--foreground)',
  headerBorder: 'var(--border)',
  navActiveBackground: 'var(--muted)',
  navActiveForeground: 'var(--foreground)',
  navInactiveColor: 'var(--muted-foreground)',
  headerPrimary: 'var(--primary)',
  headerPrimaryForeground: 'var(--primary-foreground)',
}

/**
 * The header bar's colours, when the theme gives it one: the page's text
 * where it reads on the bar, else white or near-black, whichever reads
 * better; the tabs in that text; and the main button turned over (the bar's
 * text as its fill) when it would vanish into the bar. Nothing when unset.
 */
function headerOf(
  minimal: MinimalThemeVariables,
  primaryForeground: string
): Partial<ThemeVariables> {
  const header = minimal.header ? tryCssColorToHex(minimal.header) : null
  if (!header) return {}
  const page = tryCssColorToHex(minimal.foreground)
  const best =
    contrastOf('#ffffff', header) >= contrastOf('#0a0a0a', header) ? '#ffffff' : '#0a0a0a'
  const text = page && contrastOf(page, header) >= HEADER_TEXT_CONTRAST ? page : best
  const primary = tryCssColorToHex(minimal.primary)
  const turned = !primary || contrastOf(primary, header) < HEADER_BUTTON_CONTRAST
  return {
    header,
    headerForeground: text,
    headerBorder: header,
    // The active tab steps away from the text (darker under white text,
    // lighter under dark), so it only ever reads better than the bar.
    navActiveBackground: `color-mix(in oklab, ${contrastOf(text, '#000000') > contrastOf(text, '#ffffff') ? '#000000' : '#ffffff'} 18%, ${header})`,
    navActiveForeground: text,
    navInactiveColor: text,
    headerPrimary: turned ? text : minimal.primary,
    headerPrimaryForeground: turned ? header : primaryForeground,
  }
}

/**
 * Project a full variable set back down to the ones worth storing. The input is
 * an all-optional theme, so the result is too — a variable that was never set
 * stays unset rather than being asserted into existence, and expandTheme
 * resolves it from the base palette when the theme is next rendered.
 */
export function extractMinimal(vars: ThemeVariables): Partial<MinimalThemeVariables> {
  return {
    primary: vars.primary,
    background: vars.background,
    foreground: vars.foreground,
    card: vars.card,
    muted: vars.muted,
    mutedForeground: vars.mutedForeground,
    border: vars.border,
    destructive: vars.destructive,
    success: vars.success,
    ring: vars.ring !== vars.mutedForeground ? vars.ring : undefined,
    fontSans: vars.fontSans,
    fontHeading:
      vars.fontHeading && vars.fontHeading !== NO_HEADING_FONT ? vars.fontHeading : undefined,
    radius: vars.radius,
    // Only include secondary/accent if they differ from muted
    secondary: vars.secondary !== vars.muted ? vars.secondary : undefined,
    accent: vars.accent !== vars.muted ? vars.accent : undefined,
    header: vars.header && tryCssColorToHex(vars.header) ? vars.header : undefined,
  }
}
