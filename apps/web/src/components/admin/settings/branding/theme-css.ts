/**
 * The theme editor's stylesheet, as plain functions: the editor holds the
 * whole theme as one CSS text (generated theme lines plus any Advanced CSS
 * rules), and every write regenerates the generated part from the parsed
 * palettes, so derived lines never go stale and only real hand edits are
 * kept as a remainder.
 */
import {
  DEFAULT_FONT_SANS,
  type ButtonShape,
  type CardStyle,
  type CustomFont,
  type ThemeConfig,
  type ThemeMode,
  tryCssColorToHex,
} from '@/lib/shared/theme'
import { unbrandedTheme, type MinimalThemeVariables } from '@/lib/shared/theme/expand'
import { extractCssVariables } from '@/lib/shared/theme/css-parser'
import {
  generateReadableCSS,
  isGeneratedThemeCss,
  advancedCssRemainder,
  parseCssToMinimal,
} from '@/lib/shared/theme/readable-css'

export type Palette = Partial<MinimalThemeVariables>

/**
 * What the editor publishes for the theme. `customCss` is the Advanced CSS
 * remainder only (generated theme lines are rebuilt from `theme`), or empty
 * when cssText is all generated, so leftover :root/.dark theme variables can
 * never override the saved colours. The server decides whether a remainder
 * needs the plan: a remainder equal to the stored one is a rewrite, not new CSS.
 */
export interface ThemePublish {
  theme: ThemeConfig
  customCss: string
}

/** The editor's starting stylesheet: both palettes, then any Advanced CSS rules. */
export function buildInitialCss(initialCustomCss: string, initialThemeConfig: ThemeConfig): string {
  const parsed = extractCssVariables(initialCustomCss)
  // Structured brandingConfig wins; CSS-parsed values fill gaps so a
  // CSS-only palette (empty/partial config) is not replaced by defaults.
  const lightMinimal: Palette = {
    ...unbrandedTheme('light'),
    ...parseCssToMinimal(parsed.light),
    ...(initialThemeConfig.light ?? {}),
  }
  const darkMinimal: Palette = {
    ...unbrandedTheme('dark'),
    ...parseCssToMinimal(parsed.dark),
    ...(initialThemeConfig.dark ?? {}),
  }

  // Always emit both palettes so a later switch back to user mode still
  // has the inactive side in cssText for themeForPublish to parse. Preview
  // locking uses initialThemeConfig.themeMode separately.
  const generated = generateReadableCSS(lightMinimal, darkMinimal, 'user')
  const remainder = advancedCssRemainder(initialCustomCss, generated)
  if (!remainder) return generated
  return `${generated.trimEnd()}\n\n${remainder}`
}

/** Both palettes as the stylesheet sets them, unbranded values filling any gap. */
export function palettesOf(cssText: string): { light: Palette; dark: Palette } {
  const parsed = extractCssVariables(cssText)
  return {
    light: withoutHeaderLines({ ...unbrandedTheme('light'), ...parseCssToMinimal(parsed.light) }),
    dark: withoutHeaderLines({ ...unbrandedTheme('dark'), ...parseCssToMinimal(parsed.dark) }),
  }
}

/** Lines the header colour brings along, worked out again from it on every write. */
const HEADER_LINES = [
  'headerForeground',
  'headerBorder',
  'navActiveBackground',
  'navActiveForeground',
  'navInactiveColor',
  'headerPrimary',
  'headerPrimaryForeground',
] as const

/** What a side writes for a headings font only the other side has (expand.ts). */
const NO_HEADING_FONT = 'initial'

/**
 * A palette as stored: the header's own colour only, and none where the side
 * writes the page's header (a stand-in for the other side's colour); and no
 * headings font where the side writes the stand-in for the other's.
 */
function withoutHeaderLines(palette: Palette): Palette {
  const out: Record<string, unknown> = { ...palette }
  for (const key of HEADER_LINES) delete out[key]
  if (typeof out.header === 'string' && !tryCssColorToHex(out.header)) delete out.header
  if (out.fontHeading === NO_HEADING_FONT) delete out.fontHeading
  return out as Palette
}

/** The Advanced CSS rules: everything the generator would not write for these palettes. */
export function remainderOf(cssText: string): string {
  const { light, dark } = palettesOf(cssText)
  return advancedCssRemainder(cssText, generateReadableCSS(light, dark, 'user'))
}

/**
 * The stylesheet with its palettes edited. Every write regenerates the
 * stylesheet from the parsed palettes, so derived lines never go stale. Only
 * lines the generator would not emit (hand edits, own rules) are carried
 * over, measured against the palettes before the edit.
 */
export function editPalettes(
  cssText: string,
  edit: (light: Palette, dark: Palette) => { light: Palette; dark: Palette }
): string {
  const { light, dark } = palettesOf(cssText)
  const remainder = advancedCssRemainder(cssText, generateReadableCSS(light, dark, 'user'))
  const next = edit(light, dark)
  const generated = generateReadableCSS(next.light, next.dark, 'user')
  return remainder ? `${generated.trimEnd()}\n\n${remainder}` : generated
}

/** The font stack the stylesheet sets, for the palette the mode shows. */
export function fontOf(cssText: string, themeMode: ThemeMode): string {
  const parsed = extractCssVariables(cssText)
  const light = parsed.light['--font-sans']
  const dark = parsed.dark['--font-sans']
  if (themeMode === 'dark') return dark || light || DEFAULT_FONT_SANS
  return light || dark || DEFAULT_FONT_SANS
}

/** The headings font the stylesheet sets, for the palette the mode shows; null when it is the text font. */
export function headingFontOf(cssText: string, themeMode: ThemeMode): string | null {
  const { light, dark } = palettesOf(cssText)
  const [first, second] = themeMode === 'dark' ? [dark, light] : [light, dark]
  return first.fontHeading || second.fontHeading || null
}

/** The corner radius in rem, for the palette the mode shows. */
export function radiusOf(cssText: string, themeMode: ThemeMode): number {
  const parsed = extractCssVariables(cssText)
  const light = parsed.light['--radius']
  const dark = parsed.dark['--radius']
  const raw = themeMode === 'dark' ? dark || light : light || dark
  const defaultRadius = parseFloat(unbrandedTheme('light').radius ?? '')
  if (!raw) return defaultRadius
  const match = raw.match(/^([\d.]+)rem$/)
  return match ? parseFloat(match[1]) : defaultRadius
}

/** The theme and Advanced CSS to publish, read from the stylesheet. */
export function themePublishOf(
  cssText: string,
  themeMode: ThemeMode,
  buttonShape: ButtonShape | undefined,
  // Not edited from the stylesheet: carried through so a publish keeps it.
  customFont?: CustomFont,
  // The other settings that are not stylesheet lines, carried through likewise.
  more: {
    cardStyle?: CardStyle
    customHeadingFont?: CustomFont
    headingScope?: ThemeConfig['headingScope']
  } = {}
): ThemePublish {
  const { light: lightMinimal, dark: darkMinimal } = palettesOf(cssText)
  const font = fontOf(cssText, themeMode)
  const radius = radiusOf(cssText, themeMode)
  // One headings font for both sides, as the text font is; none is no key at all.
  const heading = headingFontOf(cssText, themeMode)
  const side = ({ fontHeading: _heading, ...palette }: Palette) => ({
    ...palette,
    fontSans: font,
    ...(heading ? { fontHeading: heading } : {}),
    radius: `${radius}rem`,
  })

  const theme: ThemeConfig = {
    themeMode,
    ...(buttonShape ? { buttonShape } : {}),
    ...(customFont ? { customFont } : {}),
    // Border is the stylesheet's own look: stored as no setting.
    ...(more.cardStyle && more.cardStyle !== 'border' ? { cardStyle: more.cardStyle } : {}),
    ...(more.customHeadingFont ? { customHeadingFont: more.customHeadingFont } : {}),
    // Kept only with a headings font to keep to page headings.
    ...(more.headingScope && (heading || more.customHeadingFont)
      ? { headingScope: more.headingScope }
      : {}),
    light: side(lightMinimal),
    dark: side(darkMinimal),
  }

  const generated = generateReadableCSS(lightMinimal, darkMinimal, 'user')
  const remainder = advancedCssRemainder(cssText, generated)
  const allGenerated = isGeneratedThemeCss(cssText, lightMinimal, darkMinimal) || !remainder
  return { theme, customCss: allGenerated ? '' : remainder }
}
