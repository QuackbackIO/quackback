/// <reference types="vite/client" />
import { lazy, Suspense, type ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  redirect,
} from '@tanstack/react-router'
import { getSetupState, isOnboardingComplete } from '@quackback/db/types'
import appCss from '../globals.css?url'
import { cn } from '@/lib/shared/utils'
import { getBootstrapData, type BootstrapData } from '@/lib/server/functions/bootstrap'
import type { TenantSettings } from '@/lib/server/domains/settings'
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

// Script to handle theme preference
// Checks for forced theme (from portal settings) first, then falls back to system preference
const systemThemeScript = `
  (function() {
    var d = document.documentElement;
    var forced = document.querySelector('meta[name="theme-forced"]');
    if (forced) {
      var theme = forced.getAttribute('content');
      d.classList.remove('system', 'light', 'dark');
      d.classList.add(theme);
      d.style.colorScheme = theme;
    } else if (d.classList.contains('system')) {
      d.classList.remove('system');
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      d.classList.add(prefersDark ? 'dark' : 'light');
    }
  })()
`

export interface RouterContext {
  queryClient: QueryClient
  session?: BootstrapData['session']
  settings?: TenantSettings | null
  userRole?: 'admin' | 'member' | 'user' | null
}

// Paths that are allowed before onboarding is complete
const ONBOARDING_EXEMPT_PATHS = [
  '/onboarding',
  '/auth/',
  '/admin/login',
  '/admin/signup',
  '/api/',
  '/accept-invitation/',
]

function isOnboardingExempt(pathname: string): boolean {
  return ONBOARDING_EXEMPT_PATHS.some((path) => pathname.startsWith(path) || pathname === path)
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }) => {
    const { session, settings, userRole } = await getBootstrapData()

    if (!isOnboardingExempt(location.pathname)) {
      const setupState = getSetupState(settings?.settings?.setupState ?? null)
      if (!isOnboardingComplete(setupState)) {
        throw redirect({ to: '/onboarding' })
      }
    }

    return { session, settings, userRole }
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
      {
        rel: 'alternate',
        type: 'application/rss+xml',
        title: 'Changelog RSS Feed',
        href: '/changelog/feed',
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
      <body className={cn('min-h-screen bg-background font-sans antialiased')}>
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
