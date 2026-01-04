import * as React from 'react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import { setThemeCookie, type Theme } from '@/lib/theme'

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
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <ThemeCookieSync />
      {children}
    </NextThemesProvider>
  )
}
