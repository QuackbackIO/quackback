import type { ReactNode } from 'react'
import { HeadContent } from '@tanstack/react-router'
import { resolveDocumentTheme, SYSTEM_THEME_SCRIPT } from '@/lib/shared/theme'

/** The document rendered when the root document itself fails, with no route context. */
export function MinimalDocument({ children }: Readonly<{ children: ReactNode }>) {
  // No route context here, so the theme is unknown, so fall back to the same
  // OS-driven canvas the helper uses for `system`, so the error page doesn't
  // white-flash either.
  const { colorScheme } = resolveDocumentTheme('system')
  return (
    <html lang="en" style={{ colorScheme }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Quackback</title>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  )
}
