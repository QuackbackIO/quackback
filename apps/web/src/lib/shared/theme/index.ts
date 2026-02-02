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

export type { MinimalThemeVariables, MinimalThemeConfig } from './expand'
export {
  expandTheme,
  extractMinimal,
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
  parseThemeConfig,
  serializeThemeConfig,
  getGoogleFontsUrl,
} from './generator'

export type { ParsedCssVariables } from './css-parser'
export { extractCssVariables } from './css-parser'
