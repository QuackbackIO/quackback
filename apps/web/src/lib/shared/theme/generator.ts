import type { ThemeConfig, ThemeVariables } from './types'
import { cardStyleCss } from './card-style'
import { DEFAULT_FONT_SANS, expandTheme, NO_HEADING_FONT, PAGE_HEADER } from './expand'
import { normalizeFontSans, variableMap } from './base'
import { customFontStack, headingFontStack } from './fonts'
export { customFontStack, headingFontStack } from './fonts'
export { normalizeFontSans, variableMap } from './base'
import { isWritableCustomFont, uploadedFontFaces } from './font-uploads'

/**
 * Both sides' variables, the side with no header colour writing the page's
 * own header when the other has one: the light side's :root lines also apply
 * in dark mode, and would otherwise show there.
 */
function withPageHeaders(
  light: ThemeVariables,
  dark: ThemeVariables
): [ThemeVariables, ThemeVariables] {
  if (!light.header && !dark.header) return [light, dark]
  return [
    light.header ? light : { ...light, ...PAGE_HEADER },
    dark.header ? dark : { ...dark, ...PAGE_HEADER },
  ]
}

/**
 * The same for the headings font: the side with none empties the variable
 * when the other has one, so headings there are set in the text font.
 */
function withHeadingFonts(
  light: ThemeVariables,
  dark: ThemeVariables
): [ThemeVariables, ThemeVariables] {
  if (!light.fontHeading === !dark.fontHeading) return [light, dark]
  return [
    light.fontHeading ? light : { ...light, fontHeading: NO_HEADING_FONT },
    dark.fontHeading ? dark : { ...dark, fontHeading: NO_HEADING_FONT },
  ]
}

/** Both sides' variables, each standing in for what only the other sets. */
export const withStandIns = (light: ThemeVariables, dark: ThemeVariables) =>
  withHeadingFonts(...withPageHeaders(light, dark))

function variablesToCSS(vars: ThemeVariables): string {
  const declarations: string[] = []
  for (const [key, value] of Object.entries(vars)) {
    const cssVar = variableMap[key]
    if (cssVar && value) {
      declarations.push(`${cssVar}: ${value};`)
    }
  }
  // No space between declarations: this CSS ships in every portal and widget
  // page's HTML, twice per mode, so each byte counts.
  return declarations.join('')
}

export function generateThemeCSS(config: ThemeConfig): string {
  if (!config) return ''

  const themeMode = config.themeMode ?? 'user'
  // An unbranded config still emits the default tokens so admin, portal and
  // widget share one source of tokens when branding is absent.
  const [lightVars, darkVars] = withStandIns(
    themeMode !== 'dark' ? expandTheme(config.light ?? {}, { mode: 'light' }) : {},
    themeMode !== 'light' ? expandTheme(config.dark ?? {}, { mode: 'dark' }) : {}
  )
  for (const vars of [lightVars, darkVars]) {
    if (vars.fontSans) vars.fontSans = normalizeFontSans(vars.fontSans)
    if (vars.fontHeading) vars.fontHeading = normalizeFontSans(vars.fontHeading)
  }

  const parts: string[] = []
  // The same :root / .dark selectors as globals.css. This style comes later in
  // the document, so it wins over the stylesheet, and custom CSS after it wins
  // over this.
  const rootSelector = ':root'
  const darkClassSelector = '.dark'

  if (themeMode !== 'dark') {
    const lightCSS = variablesToCSS(lightVars)
    if (lightCSS) parts.push(`${rootSelector}{${lightCSS}}`)
  }

  if (themeMode !== 'light') {
    const darkCSS = variablesToCSS(darkVars)
    if (darkCSS) {
      if (themeMode === 'dark') {
        parts.push(`${rootSelector}{${darkCSS}}`)
      } else {
        parts.push(`${darkClassSelector}{${darkCSS}}`)
      }
    }
  }

  const bodyDeclarations: string[] = []
  if (lightVars.fontSans) bodyDeclarations.push(`--font-sans: ${lightVars.fontSans}`)
  // The body restates a radius only when the config sets one, because a body
  // declaration beats a :root one and would hide a radius kept in custom CSS.
  // The stylesheet supplies the default otherwise.
  const radiusConfigured = typeof config.light?.radius === 'string' && config.light.radius.trim()
  if (lightVars.radius && radiusConfigured) bodyDeclarations.push(`--radius: ${lightVars.radius}`)
  if (bodyDeclarations.length > 0) {
    parts.push(`body { ${bodyDeclarations.join('; ')}; }`)
  }

  if (lightVars.fontSans) {
    parts.push(`html body { font-family: ${lightVars.fontSans} !important; }`)
  }

  return parts.join(' ')
}

/** The settings `themeExtrasCss` writes: everything in a theme that is not a theme variable. */
export type ThemeExtras = Pick<
  ThemeConfig,
  | 'buttonShape'
  | 'customFont'
  | 'customHeadingFont'
  | 'headingScope'
  | 'cardStyle'
  | 'themeMode'
  | 'light'
  | 'dark'
>

/**
 * The theme settings that are not theme variables (the button shape, the
 * card style, and an uploaded font's @font-face rules), as CSS. Shared by
 * the live stylesheet and the admin preview's draft, which carries them
 * apart from its generated stylesheet. Pill buttons and bordered cards are
 * the stylesheet default, so the live theme writes a token only for the
 * other choices; `explicit` writes the default too, for a draft over a saved
 * 'corners' or 'shadow'. An uploaded family's place in the font stack is the
 * caller's: the live theme writes it into the theme variables. The card
 * style is worked out from the palettes (`light`, `dark`) it sits on.
 */
export function themeExtrasCss(extras: ThemeExtras, options: { explicit?: boolean } = {}): string {
  const faces = customFontStack(extras.customFont) ? uploadedFontFaces(extras.customFont) : ''
  const headingFaces = uploadedFontFaces(extras.customHeadingFont)
  const button =
    extras.buttonShape === 'corners'
      ? ':root { --radius-button: calc(var(--radius) * .75); }'
      : options.explicit && extras.buttonShape === 'pill'
        ? ':root { --radius-button: var(--radius-item); }'
        : ''
  const cards = cardStyleCss(
    extras.cardStyle,
    { light: extras.light, dark: extras.dark },
    // A draft always carries both sides: the frame shows either.
    options.explicit ? { explicit: true } : { themeMode: extras.themeMode }
  )
  // Small titles (a post's, the header's name) read --font-title before the
  // headings font: the text font when the headings face is for page headings alone.
  const titles =
    extras.headingScope === 'page'
      ? ':root { --font-title: var(--font-sans); }'
      : options.explicit
        ? ':root { --font-title: initial; }'
        : ''
  return [faces, headingFaces, button, cards, titles].filter(Boolean).join(' ')
}

/** Portal, widget and auth helper: the default tokens with the workspace's branding on top. */
export function generateWorkspaceThemeCSS(config: ThemeConfig | null | undefined): string {
  // An uploaded family leads the stack, so every surface that reads --font-sans
  // (portal, widget, sign-in pages, access gate) gets it from this one place.
  const stack = customFontStack(config?.customFont)
  // An uploaded headings family likewise leads the headings', over the text font.
  const textStack = (mode: 'light' | 'dark') =>
    normalizeFontSans(
      stack ?? expandTheme(config?.[mode] ?? {}, { mode }).fontSans ?? DEFAULT_FONT_SANS
    )
  const side = (mode: 'light' | 'dark') => {
    const heading = headingFontStack(config?.customHeadingFont, textStack(mode))
    return {
      ...config?.[mode],
      ...(stack ? { fontSans: stack } : {}),
      ...(heading ? { fontHeading: heading } : {}),
    }
  }
  const themed: ThemeConfig =
    stack || isWritableCustomFont(config?.customHeadingFont)
      ? { ...config, light: side('light'), dark: side('dark') }
      : (config ?? {})
  return [generateThemeCSS(themed), themeExtrasCss(config ?? {})].filter(Boolean).join(' ').trim()
}

export function parseThemeConfig(json: string | null | undefined): ThemeConfig | null {
  if (!json) return null
  try {
    const config = JSON.parse(json)
    if (typeof config !== 'object') return null
    return config as ThemeConfig
  } catch {
    return null
  }
}

export function serializeThemeConfig(config: ThemeConfig): string {
  return JSON.stringify(config)
}
