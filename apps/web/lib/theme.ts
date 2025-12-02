export const THEME_COOKIE_NAME = 'theme'
export type Theme = 'light' | 'dark' | 'system'

export function getThemeCookie(cookieHeader: string | null): Theme {
  if (!cookieHeader) return 'system'

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=')
    acc[key] = value
    return acc
  }, {} as Record<string, string>)

  const theme = cookies[THEME_COOKIE_NAME]
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    return theme
  }
  return 'system'
}

export function setThemeCookie(theme: Theme): void {
  document.cookie = `${THEME_COOKIE_NAME}=${theme};path=/;max-age=31536000;samesite=lax`
}
