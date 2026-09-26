// ============================================================================
// Theme Cookie Helpers
// ============================================================================

export const THEME_COOKIE_NAME = 'theme'
export type Theme = 'light' | 'dark' | 'system'

const VALID_THEMES = ['light', 'dark', 'system'] as const

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const cookie of cookieHeader.split(';')) {
    const [key, value] = cookie.trim().split('=')
    if (key && value) cookies[key] = value
  }
  return cookies
}

export function getThemeCookie(cookieHeader: string | null): Theme {
  if (!cookieHeader) return 'system'
  const theme = parseCookies(cookieHeader)[THEME_COOKIE_NAME]
  return VALID_THEMES.includes(theme as Theme) ? (theme as Theme) : 'system'
}

export function setThemeCookie(themeValue: Theme): void {
  document.cookie = `${THEME_COOKIE_NAME}=${themeValue};path=/;max-age=31536000;samesite=lax`
}

/**
 * Parse a `Sec-CH-Prefers-Color-Scheme` request header. The browser sends this
 * (after we advertise `Accept-CH`) as the structured-field token `light` or
 * `dark`, telling the server the OS preference so `system` can be resolved
 * during SSR. Returns null when absent or unrecognized.
 */
export function parsePrefersColorScheme(value: string | null | undefined): 'light' | 'dark' | null {
  if (!value) return null
  const token = value.trim().replace(/^"|"$/g, '').toLowerCase()
  return token === 'dark' || token === 'light' ? token : null
}

const PREFERS_COLOR_SCHEME_HINT = 'Sec-CH-Prefers-Color-Scheme'

/**
 * The client-hint response headers for a document.
 *
 * `Accept-CH` asks Chromium to send the OS color scheme with later requests
 * to this origin, so from then on `system` is resolved during SSR and the
 * markup carries the theme. There is deliberately no `Critical-CH`: it makes
 * Chromium discard a first visit's response and request the page again, so
 * every first visit rendered every page twice. A document rendered without
 * the hint resolves `system` in {@link SYSTEM_THEME_SCRIPT} instead, before
 * any of its body can paint.
 */
export function colorSchemeHintHeaders(): Record<string, string> {
  return { 'Accept-CH': PREFERS_COLOR_SCHEME_HINT }
}

/**
 * Resolves a `system` theme the server could not: the first thing in <head>
 * of a document rendered without the OS preference (a first visit, or a
 * browser that sends no client hints). As a parser-blocking script ahead of
 * the body it runs before anything of the page can paint, so the first frame
 * is already in the right theme rather than waiting for next-themes' script
 * in <body>, which a network chunk boundary can delay past a paint.
 *
 * It makes next-themes' choice: the preference next-themes stored (under its
 * default `theme` key), else the OS preference.
 */
export const SYSTEM_THEME_SCRIPT =
  "(function(){try{var d=document.documentElement,t;try{t=localStorage.getItem('theme')}catch(e){}" +
  "if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';" +
  'd.classList.add(t);d.style.colorScheme=t}catch(e){}})()'

/**
 * Resolve the `class` and `color-scheme` to put on the SSR-rendered <html> so
 * the first paint already matches the chosen theme. Skipping this leaves the
 * browser painting its default (light) canvas during load — a white flash
 * before next-themes' inline script swaps in the dark class.
 *
 * For an explicit theme we commit to it (e.g. color-scheme:dark keeps the
 * canvas dark even on a light-mode OS). `system` is resolved from the OS
 * preference when the browser sent the `Sec-CH-Prefers-Color-Scheme` hint;
 * without it (Firefox/Safari, or a first visit before the hint is known) we
 * leave the class off for {@link SYSTEM_THEME_SCRIPT} to add, and let
 * `light dark` tell the browser to take the canvas from the OS preference.
 */
export function resolveDocumentTheme(
  theme: Theme,
  systemPreference?: 'light' | 'dark' | null
): {
  className: string | undefined
  colorScheme: 'light' | 'dark' | 'light dark'
} {
  const resolved = theme === 'system' ? systemPreference : theme
  if (resolved === 'dark') return { className: 'dark', colorScheme: 'dark' }
  if (resolved === 'light') return { className: 'light', colorScheme: 'light' }
  return { className: undefined, colorScheme: 'light dark' }
}

// ============================================================================
// Theme Types & Utilities
// ============================================================================

export type {
  ThemeVariables,
  ThemeConfig,
  ThemePreset,
  CoreThemeVariable,
  ThemeMode,
} from './types'
export { CORE_THEME_VARIABLES } from './types'

export type { MinimalThemeVariables, MinimalThemeConfig, ThemeBaseline } from './expand'
export {
  expandTheme,
  extractMinimal,
  unbrandedTheme,
  DEFAULT_FONT_SANS,
  REFINED_DARK_BASE,
  REFINED_LIGHT_BASE,
  parseOklch,
  formatOklch,
  adjustHue,
  computeContrastForeground,
  generateChartColors,
} from './expand'

export { themePresets, presetNames, primaryPresetIds, getPreset } from './presets'

export { hexToOklch, oklchToHex, isValidHex, isValidOklch } from './colors'

export {
  generateThemeCSS,
  generateWorkspaceThemeCSS,
  generateReadableCSS,
  isGeneratedThemeCss,
  advancedCssRemainder,
  parseCssToMinimal,
  replaceCssVar,
  parseThemeConfig,
  serializeThemeConfig,
  normalizeFontSans,
} from './generator'

export type { ParsedCssVariables } from './css-parser'
export { extractCssVariables } from './css-parser'

export type { BrandingFontId } from './fonts'
export { BRANDING_FONTS, fontIdForValue, resolveBrandingFontId, readFontSans } from './fonts'

export { loadBrandingFont } from './font-loader'
