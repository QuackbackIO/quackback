/// <reference types="vite/client" />
import { lazy, Suspense, type ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from '@tanstack/react-router'
import appCss from '../globals.css?url'
import { cn } from '@/lib/utils'
import { getSession } from '@/lib/server-functions/auth'
import { getRequestContext } from '@/lib/server-functions/workspace'
import { fetchSettingsWithAllConfigs } from '@/lib/server-functions/settings'
import type { SettingsWithAllConfigs } from '@/lib/settings'
import type { RequestContext } from '@/lib/tenant'
import { WorkspaceNotFoundPage } from '@/components/workspace-not-found'
import { ThemeProvider } from '@/components/theme-provider'

// Lazy load devtools in development only
const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-router-devtools').then((mod) => ({
        default: mod.TanStackRouterDevtools,
      }))
    )
  : () => null

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((mod) => ({
        default: mod.ReactQueryDevtools,
      }))
    )
  : () => null

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

// RouterContext is what's available in the context at different points:
// - queryClient: always available (provided in createRouter)
// - requestContext: discriminated union of context types (available after beforeLoad)
// - session/settingsData: available after beforeLoad runs for tenant/self-hosted contexts
export interface RouterContext {
  queryClient: QueryClient
  /** Discriminated request context - determines how to handle the request */
  requestContext?: RequestContext
  session?: Awaited<ReturnType<typeof getSession>>
  /** @deprecated Use settingsData.settings instead */
  settings?: SettingsWithAllConfigs['settings']
  /** Consolidated settings data (single query) - includes all configs and branding */
  settingsData?: SettingsWithAllConfigs
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    // Get discriminated request context in a single call
    const requestContext = await getRequestContext()

    // App domain routes (e.g., app.quackback.io) skip tenant resolution
    if (requestContext.type === 'app-domain') {
      return { requestContext }
    }

    // Unknown domain in multi-tenant mode - no database access available
    if (requestContext.type === 'unknown') {
      return { requestContext }
    }

    // Self-hosted or tenant mode - safe to query database
    // Fetch session and all settings data in parallel
    const [session, settingsData] = await Promise.all([getSession(), fetchSettingsWithAllConfigs()])

    // Provide backward-compatible 'settings' for existing routes
    return { requestContext, session, settingsData, settings: settingsData.settings }
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
  const { requestContext } = Route.useRouteContext()

  // App domain routes (e.g., /get-started) bypass workspace check
  if (requestContext?.type === 'app-domain') {
    return (
      <RootDocument>
        <Outlet />
      </RootDocument>
    )
  }

  // Unknown domain in multi-tenant mode - show workspace not found
  if (requestContext?.type === 'unknown') {
    return (
      <RootDocument>
        <WorkspaceNotFoundPage />
      </RootDocument>
    )
  }

  // Self-hosted or tenant mode - render normally with devtools
  return (
    <RootDocument>
      <Outlet />
      <Suspense>
        <ReactQueryDevtools buttonPosition="bottom-left" />
        <TanStackRouterDevtools position="bottom-right" />
      </Suspense>
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
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
