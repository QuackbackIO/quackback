import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { THEME_COOKIE_NAME, type Theme } from '@/lib/theme'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Quackback',
  description: 'Open-source customer feedback platform',
}

// Script to handle system theme preference when theme is set to 'system'
const systemThemeScript = `
  (function() {
    if (document.documentElement.classList.contains('system')) {
      document.documentElement.classList.remove('system')
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.add(prefersDark ? 'dark' : 'light')
    }
  })()
`

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const themeCookie = cookieStore.get(THEME_COOKIE_NAME)?.value as Theme | undefined
  const theme = themeCookie || 'system'

  // Determine the class to apply
  // For 'system', we'll add 'system' class and let the script handle it
  // For explicit themes, apply directly
  const themeClass = theme === 'system' ? 'system' : theme

  return (
    <html lang="en" className={themeClass} suppressHydrationWarning>
      <head>
        {theme === 'system' && (
          <script dangerouslySetInnerHTML={{ __html: systemThemeScript }} />
        )}
      </head>
      <body className={cn('min-h-screen bg-background font-sans antialiased', inter.variable)}>
        <ThemeProvider
          attribute="class"
          defaultTheme={theme}
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
