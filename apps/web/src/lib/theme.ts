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

import * as themeModule from './theme/index'
export { themeModule as theme }

export * from './theme/index'
