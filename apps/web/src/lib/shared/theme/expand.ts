import { cssColorToOklch, oklchToHex, oklchToHexInGamut, tryCssColorToHex } from './colors'
import type { ThemeVariables } from './types'
import { DEFAULT_FONT_SANS, MINIMAL_THEME_VARIABLE_KEYS, NO_HEADING_FONT } from './base'
export { DEFAULT_FONT_SANS, MINIMAL_THEME_VARIABLE_KEYS, NO_HEADING_FONT } from './base'

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
  const brand = shown?.primary ?? resolved.primary
  // The button fill is --primary itself: every filled use of the main colour
  // (buttons, badges, counters, the header's button) carries words in
  // --primary-foreground, so the fill that keeps white words readable is the
  // one all of them draw. A mid-tone fill is darkened only as far as that takes.
  const button = buttonOf(brand)
  const minimal: MinimalThemeVariables = {
    ...resolved,
    ...readableSurfaces(resolved),
    primary: button.fill,
  }
  const shadows = options.mode === 'light' ? LIGHT_SHADOWS : DARK_SHADOWS
  const primaryForeground = button.ink
  const destructiveForeground = computeContrastForeground(minimal.destructive)
  // The main colour drawn as text (links, vote counts, icons), worked out from
  // the fill as shown: the editor stores what this writes, so starting from
  // anything else would move the ink again on every edit. --accent-ink is the
  // same shade: light pages send any text-primary left in the stylesheet to
  // it (globals.css).
  const primaryInk = primaryInkOn(minimal.primary, minimal)
  const charts = generateChartColors(minimal.primary)

  return {
    primary: minimal.primary,
    primaryInk,
    accentInk: primaryInk,
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
    ring:
      minimal.ring && minimal.ring !== resolved.primary && minimal.ring !== minimal.primary
        ? minimal.ring
        : minimal.mutedForeground,
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
/** Text reads at this contrast or more on what it sits on (WCAG AA, normal-size text). */
export const READABLE_TEXT = 4.5
/** The words on a filled button read at this contrast or more. */
const BUTTON_TEXT_CONTRAST = READABLE_TEXT
/**
 * A fill on which pure white reaches this contrast is one white words were
 * designed for (a mid-tone teal, green or indigo): it keeps white words, and
 * the fill is darkened until they read at 4.5:1. Under it the words turn dark.
 */
const WHITE_IS_NATURAL = 3
const LIGHT_INK = 'oklch(0.985 0 0)'
const DARK_INK = 'oklch(0.145 0 0)'

/**
 * A main colour for a dark page, when the one given would not show on it: a
 * navy button on near-black is there, and cannot be seen. The colour is
 * lightened (OKLCH lightness, same hue and chroma) only as far as it takes
 * for the button as drawn (its fill after buttonOf, which may darken a
 * mid-tone for white words) to stand off the page. On most dark pages a
 * lightened colour with white words does; on a dark grey one there may be no
 * such colour, and the lightening goes on to one dark words read on. Null
 * when the button already shows, the page is not a dark one, or a colour
 * cannot be read: nothing is changed then. Judging the button as drawn keeps
 * this stable: the colour it returns comes back unchanged.
 */
export function darkMainColour(
  primary: string,
  background: string
): { primary: string; foreground: string } | null {
  const page = tryCssColorToHex(background)
  const from = tryCssColorToHex(primary)
  const lch = parseOklch(primary)
  if (!page || !from || !lch) return null
  // Only for a dark page: on a mid-tone one no lighter colour stands off it.
  if (relativeLuminance(page) > 0.2) return null
  const shows = (fill: string) => {
    const hex = tryCssColorToHex(fill)
    return !!hex && contrastOf(hex, page) >= BUTTON_SHOWS
  }
  if (shows(buttonOf(primary).fill)) return null
  for (let l = Math.ceil(lch.l * 100) / 100; l <= 1.0001; l += 0.01) {
    const candidate = formatOklch(Math.min(1, l), lch.c, lch.h)
    if (relativeLuminance(oklchToHex(candidate)) <= relativeLuminance(page)) continue
    const button = buttonOf(candidate)
    if (shows(button.fill)) return { primary: button.fill, foreground: button.ink }
  }
  return null
}

/**
 * A filled button's colour and the words on it, the words reading at 4.5:1.
 * The usual ink (near-white on a dark fill, near-black on a light one) where
 * it reads, or near-black's full strength on a light fill. A mid-tone fill
 * that white words were designed for (pure white reaches 3:1 on it: teal,
 * indigo) keeps white words, and the fill is darkened (OKLCH lightness in
 * steps of 0.002, same hue) only as far as it takes for them to read: the words never
 * turn black on it. A light fill (yellow, lime) takes dark words, which read
 * on it at 7:1 or more. The fill comes back as given when it is not changed,
 * else as the hex that was measured.
 */
export function buttonOf(fill: string): { fill: string; ink: string } {
  const usual = computeContrastForeground(fill)
  const hex = tryCssColorToHex(fill)
  if (!hex) return { fill, ink: usual }
  const inkOn = (surface: string, ink: string) =>
    contrastOf(tryCssColorToHex(ink) ?? oklchToHex(ink), surface)
  if (inkOn(hex, usual) >= BUTTON_TEXT_CONTRAST) return { fill, ink: usual }
  if (usual === DARK_INK && inkOn(hex, '#000000') >= BUTTON_TEXT_CONTRAST)
    return { fill, ink: '#000000' }
  if (inkOn(hex, '#ffffff') >= WHITE_IS_NATURAL) {
    const lch = parseOklch(hex)
    const steps = lch ? Math.ceil(lch.l * 500) : 0
    for (let step = 0; step <= steps; step++) {
      const candidate = step === 0 ? hex : oklchToHexInGamut(lch!.l - step / 500, lch!.c, lch!.h)
      const changed = (ink: string) => ({ fill: step === 0 ? fill : candidate, ink })
      if (inkOn(candidate, LIGHT_INK) >= BUTTON_TEXT_CONTRAST) return changed(LIGHT_INK)
      if (inkOn(candidate, '#ffffff') >= BUTTON_TEXT_CONTRAST) return changed('#ffffff')
    }
    // Not reached for any colour that can be read: white reads on black.
    return { fill: '#000000', ink: '#ffffff' }
  }
  // White under 3:1 means a light fill, on which black reads at 7:1 or more.
  return { fill, ink: inkOn(hex, DARK_INK) >= BUTTON_TEXT_CONTRAST ? DARK_INK : '#000000' }
}

/** `amount` of `toward` mixed into `from`, per sRGB channel: how an alpha tint composites. */
export function mixHex(from: string, toward: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(from, i) + (channel(toward, i) - channel(from, i)) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** The lowest contrast of a luminance on surfaces given by theirs. */
function worstOn(luminance: number, surfaces: number[]): number {
  let worst = Infinity
  for (const surface of surfaces) {
    const ratio = (Math.max(luminance, surface) + 0.05) / (Math.min(luminance, surface) + 0.05)
    if (ratio < worst) worst = ratio
  }
  return worst
}

const hexesOf = (colours: Array<string | undefined>): string[] =>
  colours.flatMap((colour) => {
    const hex = colour ? tryCssColorToHex(colour) : null
    return hex ? [hex] : []
  })

/** How many lightness steps (0.01 each) text moves past reading on `must` to read on `want` too. */
const WANT_STEPS = 8

/**
 * A colour for text, kept as near to `colour` as reads: moved in OKLCH
 * lightness (same hue; chroma lowered only where sRGB cannot hold it) in
 * steps of 0.01 toward white or black, whichever reads
 * better, until it reaches 4.5:1 on every one of `must` and, where it can,
 * on every one of `want` too (looking `reach` steps past the first that
 * reads on `must`); then the other way; then pure white or black.
 * On any one surface pure white or pure black reaches 4.5:1 (4.58 at the
 * worst), so `must` holds whenever its surfaces sit on one side of the text.
 * Comes back as given when it already reads or cannot be read, else as the
 * hex that was measured.
 */
export function readableText(
  colour: string,
  must: string[],
  want: string[] = [],
  reach = WANT_STEPS
): string {
  const hex = tryCssColorToHex(colour)
  const hard = hexesOf(must).map(relativeLuminance)
  const all = [...hard, ...hexesOf(want).map(relativeLuminance)]
  if (!hex || hard.length === 0 || worstOn(relativeLuminance(hex), all) >= READABLE_TEXT)
    return colour
  const lch = parseOklch(hex)
  const upFirst = worstOn(1, hard) >= worstOn(0, hard)
  for (const up of [upFirst, !upFirst]) {
    let fallback: string | null = null
    let beyond = 0
    for (let step = 1; step <= 101; step++) {
      const l = lch ? (up ? lch.l + step / 100 : lch.l - step / 100) : -1
      // Past the end of the lightness range: pure white or black.
      const candidate =
        l >= 0 && l <= 1 ? oklchToHexInGamut(l, lch!.c, lch!.h) : up ? '#ffffff' : '#000000'
      const luminance = relativeLuminance(candidate)
      if (worstOn(luminance, hard) >= READABLE_TEXT) {
        if (worstOn(luminance, all) >= READABLE_TEXT) return candidate
        fallback ??= candidate
        // A few steps past the first that reads on `must` and no further: what
        // `want` needs beyond that is not worth losing the colour for.
        if (++beyond > reach) break
      }
      if (l < 0 || l > 1) break
    }
    if (fallback) return fallback
  }
  return upFirst ? '#ffffff' : '#000000'
}

type ReadableSurfaces = Pick<
  MinimalThemeVariables,
  'foreground' | 'card' | 'muted' | 'mutedForeground'
>

/**
 * The page's text and the surfaces it sits on, made to read: the text moved
 * just far enough to reach 4.5:1 on the page, and on the card and quiet fill
 * where a shade of it can; a card or quiet fill it still would not read on
 * drawn toward the page until it does (and kept on the
 * page's side of the text, so one ink can read on all of them); and the quiet
 * text moved to read on the page, the card and the quiet fill. All of it
 * untouched where it already reads, as on every ordinary page.
 */
function readableSurfaces(resolved: MinimalThemeVariables): Partial<ReadableSurfaces> {
  const page = tryCssColorToHex(resolved.background)
  if (!page) return {}
  // Far enough to read on the card and quiet fill too where it can, so those
  // are drawn toward the page only when no shade of the text reads on all.
  const foreground = readableText(resolved.foreground, [page], [resolved.card, resolved.muted], 100)
  const text = tryCssColorToHex(foreground)
  if (!text) return {}
  const textIsLighter = relativeLuminance(text) > relativeLuminance(page)
  const pulled = (surface: string) => {
    const hex = tryCssColorToHex(surface)
    if (!hex) return surface
    for (let step = 0; step <= 20; step++) {
      const candidate = step === 0 ? hex : mixHex(hex, page, step / 20)
      const sameSide = relativeLuminance(candidate) < relativeLuminance(text) === textIsLighter
      if (sameSide && contrastOf(text, candidate) >= READABLE_TEXT)
        return step === 0 ? surface : candidate
    }
    return page
  }
  const card = pulled(resolved.card)
  const muted = pulled(resolved.muted)
  const mutedForeground = readableText(resolved.mutedForeground, [page, card, muted])
  return { foreground, card, muted, mutedForeground }
}

/**
 * The main colour as text (links, vote counts, icons): same hue, darker on a
 * light page and lighter on a dark one, reading at 4.5:1 on the page, its
 * cards and its quiet fills; and, where it can, on what else it is drawn on:
 * a 15 to 20% tint of the main colour (a badge, a voted count) and a flat
 * card's fill (up to 10% of the text mixed into the page).
 */
function primaryInkOn(brand: string, palette: MinimalThemeVariables): string {
  const page = tryCssColorToHex(palette.background)
  const text = tryCssColorToHex(palette.foreground)
  const fill = tryCssColorToHex(brand)
  if (!page || !fill) return brand
  const surfaces = hexesOf([palette.background, palette.card, palette.muted])
  const tints = hexesOf([palette.background, palette.card]).flatMap((surface) => [
    mixHex(surface, fill, 0.15),
    mixHex(surface, fill, 0.2),
  ])
  const flat = text ? [mixHex(page, text, 0.1)] : []
  return readableText(brand, surfaces, [...tints, ...flat])
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
 * where it reads on the bar at 4.5:1, else white or near-black, whichever
 * reads better, else (on a mid-tone bar, where neither quite does) pure white
 * or black, one of which reads at 4.58:1 or more on any colour; the tabs in
 * that text; and the main button turned over (the bar's text as its fill)
 * when it would vanish into the bar. Nothing when unset.
 */
function headerOf(
  minimal: MinimalThemeVariables,
  primaryForeground: string
): Partial<ThemeVariables> {
  const header = minimal.header ? tryCssColorToHex(minimal.header) : null
  if (!header) return {}
  const page = tryCssColorToHex(minimal.foreground)
  const whiteFirst = contrastOf('#ffffff', header) >= contrastOf('#0a0a0a', header)
  const inks = whiteFirst ? ['#ffffff', '#0a0a0a', '#000000'] : ['#0a0a0a', '#ffffff', '#000000']
  const text =
    [page, ...inks].find(
      (ink): ink is string => !!ink && contrastOf(ink, header) >= HEADER_TEXT_CONTRAST
    ) ?? (contrastOf('#ffffff', header) >= contrastOf('#000000', header) ? '#ffffff' : '#000000')
  const primary = tryCssColorToHex(minimal.primary)
  const turned = !primary || contrastOf(primary, header) < HEADER_BUTTON_CONTRAST
  return {
    header,
    headerForeground: text,
    headerBorder: header,
    // The active tab steps away from the text (darker under lighter text,
    // lighter under darker), so it only ever reads better than the bar.
    navActiveBackground: `color-mix(in oklab, ${relativeLuminance(text) > relativeLuminance(header) ? '#000000' : '#ffffff'} 18%, ${header})`,
    navActiveForeground: text,
    navInactiveColor: text,
    // Turned over, the button is the bar's text with the bar's colour as its
    // words: the same pair as the text on the bar, so it reads as that does.
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
