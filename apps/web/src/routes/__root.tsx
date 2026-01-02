/// <reference types="vite/client" />
import { lazy, Suspense, type ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from '@tanstack/react-router'
import appCss from '../globals.css?url'
import { cn } from '@/lib/utils'
import { getSession } from '@/lib/server-functions/auth'
import { getSettings } from '@/lib/server-functions/workspace'

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
// - session/settings: available after beforeLoad runs (optional in type, guaranteed in child routes)
export interface RouterContext {
  queryClient: QueryClient
  session?: Awaited<ReturnType<typeof getSession>>
  settings?: Awaited<ReturnType<typeof getSettings>>
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const [session, settings] = await Promise.all([getSession(), getSettings()])
    return { session, settings }
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
        {children}
        <Scripts />
      </body>
    </html>
  )
}
