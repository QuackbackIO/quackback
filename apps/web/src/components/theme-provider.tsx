import * as React from 'react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import { setThemeCookie, type Theme } from '@/lib/shared/theme'

function ThemeCookieSync() {
  const { theme } = useTheme()

  React.useEffect(() => {
    if (theme) {
      setThemeCookie(theme as Theme)
    }
  }, [theme])

  return null
}

export function ThemeProvider({
  children,
  syncCookie = true,
  ...props
}: React.ComponentProps<typeof NextThemesProvider> & {
  /**
   * Persist the theme preference to the SSR cookie. Off in the widget iframe:
   * its document must never rewrite the visitor's own theme preference
   * (same-origin embeds share the cookie, and the preview forces a theme).
   */
  syncCookie?: boolean
}) {
  return (
    <NextThemesProvider {...props}>
      {syncCookie && <ThemeCookieSync />}
      {children}
    </NextThemesProvider>
  )
}
