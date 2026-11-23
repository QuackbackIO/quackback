/**
 * The theme's plain facts: the variables a stored theme may carry, the
 * default and "no headings font" values, and the font-name aliases. Kept
 * apart from the theme engine (expand.ts, generator.ts) so the settings
 * schema and the font list, which every admin settings page loads, never
 * load the engine.
 */

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
  'pickedPrimary',
  'pickedForeground',
  'pickedCard',
  'pickedMuted',
  'pickedMutedForeground',
] as const

/**
 * The colours a theme may draw other than as picked (a button fill deepened
 * for white words, pale text darkened to read), each with the variable that
 * keeps the one picked. A theme carries that variable only while the two
 * differ; the picked one is what the editor shows and what expansion works
 * from (expandTheme). Never written into the live theme CSS.
 */
export const PICKED_KEYS = {
  primary: 'pickedPrimary',
  foreground: 'pickedForeground',
  card: 'pickedCard',
  muted: 'pickedMuted',
  mutedForeground: 'pickedMutedForeground',
} as const

export type PickableKey = keyof typeof PICKED_KEYS

/** The colour picked for a role: the kept one where the theme draws another, else the one set. */
export function pickedColour(
  palette: Partial<Record<PickableKey | (typeof PICKED_KEYS)[PickableKey], string>>,
  key: PickableKey
): string | undefined {
  return palette[PICKED_KEYS[key]] || palette[key]
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

// Maps a font family saved under an old name to the one now self-hosted in
// globals.css. Geist self-hosts via @fontsource/geist-sans, whose @font-face
// family is "Geist Sans", so a fontSans saved before that rename still resolves.
const LEGACY_FONT_ALIASES: Record<string, string> = {
  '"Geist"': '"Geist Sans"',
}

/** Rewrite legacy font-family names in a fontSans stack to their bundled equivalent. */
export function normalizeFontSans(fontSans: string): string {
  let normalized = fontSans
  for (const [legacy, current] of Object.entries(LEGACY_FONT_ALIASES)) {
    normalized = normalized.replaceAll(legacy, current)
  }
  return normalized
}

/** Each theme variable's CSS custom property. */
export const variableMap: Record<string, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  primaryInk: '--primary-ink',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  accentInk: '--accent-ink',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  success: '--success',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
  fontSans: '--font-sans',
  fontHeading: '--font-heading',
  radius: '--radius',
  shadow2xs: '--shadow-2xs',
  shadowXs: '--shadow-xs',
  shadowSm: '--shadow-sm',
  shadow: '--shadow',
  shadowMd: '--shadow-md',
  shadowLg: '--shadow-lg',
  shadowXl: '--shadow-xl',
  shadow2xl: '--shadow-2xl',
  header: '--header-background',
  headerForeground: '--header-foreground',
  headerBorder: '--header-border',
  navActiveBackground: '--nav-active-background',
  navActiveForeground: '--nav-active-foreground',
  navInactiveColor: '--nav-inactive-color',
  headerPrimary: '--header-primary',
  headerPrimaryForeground: '--header-primary-foreground',
  pickedPrimary: '--picked-primary',
  pickedForeground: '--picked-foreground',
  pickedCard: '--picked-card',
  pickedMuted: '--picked-muted',
  pickedMutedForeground: '--picked-muted-foreground',
}
