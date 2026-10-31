import * as React from 'react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import { setThemeCookie, THEME_COOKIE_NAME, type Theme } from '@/lib/shared/theme'

function ThemeCookieSync({ name }: { name: string }) {
  const { theme } = useTheme()

  React.useEffect(() => {
    if (theme) {
      setThemeCookie(theme as Theme, name)
    }
  }, [theme, name])

  return null
}

export function ThemeProvider({
  children,
  syncCookie = true,
  storageKey = THEME_COOKIE_NAME,
  ...props
}: React.ComponentProps<typeof NextThemesProvider> & {
  /**
   * Persist the theme preference to the SSR cookie. Off in the widget iframe:
   * its document must never rewrite the visitor's own theme preference
   * (same-origin embeds share the cookie, and the preview forces a theme).
   */
  syncCookie?: boolean
}) {
  // The cookie shares the storage key's name: the server renders from one,
  // the client from the other, and both hold the same choice.
  return (
    <NextThemesProvider storageKey={storageKey} {...props}>
      {syncCookie && <ThemeCookieSync name={storageKey} />}
      {children}
    </NextThemesProvider>
  )
}
