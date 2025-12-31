/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import appCss from '../globals.css?url'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { getSession } from '@/lib/server-functions/auth'
import { getSettings } from '@/lib/server-functions/workspace'

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

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  session: Awaited<ReturnType<typeof getSession>>
  settings: Awaited<ReturnType<typeof getSettings>>
}>()({
  beforeLoad: async () => {
    // Fetch session and settings at the root level
    // These will be available to all child routes via context
    const [session, settings] = await Promise.all([getSession(), getSettings()])

    return {
      session,
      settings,
    }
  },
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Quackback',
      },
      {
        name: 'description',
        content: 'Open-source customer feedback platform',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap',
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()

  return (
    <RootDocument>
      <NuqsAdapter>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Outlet />
          <Toaster />
          <ReactQueryDevtools client={queryClient} buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </ThemeProvider>
      </NuqsAdapter>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="system" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: systemThemeScript }} />
      </head>
      <body className={cn('min-h-screen bg-background font-sans antialiased font-sans')}>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
