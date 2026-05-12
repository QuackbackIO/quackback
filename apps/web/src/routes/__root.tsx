/// <reference types="vite/client" />
import { Component, type ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { getSetupState, isOnboardingComplete } from '@/lib/shared/db-types'
import appCss from '../globals.css?url'
import { getBootstrapData, type BootstrapData } from '@/lib/server/functions/bootstrap'
import type { TenantSettings } from '@/lib/shared/types/settings'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { OttHandler } from '@/components/shared/ott-handler'
import { SuspendedView } from '@/components/shared/suspended-view'
import { isSuspensionExempt } from '@/lib/server/middleware/suspension-paths'

export interface RouterContext {
  queryClient: QueryClient
  baseUrl?: string
  session?: BootstrapData['session']
  settings?: TenantSettings | null
  userRole?: 'admin' | 'member' | 'user' | null
  themeCookie?: BootstrapData['themeCookie']
  managedFieldPaths?: string[]
  state?: 'active' | 'suspended' | 'deleting'
  registeredAuthProviders?: string[]
}

// Paths that are allowed before onboarding is complete
const ONBOARDING_EXEMPT_PATHS = [
  '/onboarding',
  '/auth/',
  '/admin/login',
  '/admin/signup',
  '/api/',
  '/complete-signup/',
  '/oauth/',
  '/.well-known/',
  '/widget',
]

function isOnboardingExempt(pathname: string): boolean {
  return ONBOARDING_EXEMPT_PATHS.some((path) => pathname.startsWith(path))
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }) => {
    const {
      baseUrl,
      session,
      settings,
      userRole,
      themeCookie,
      managedFieldPaths,
      state,
      registeredAuthProviders,
    } = await getBootstrapData()

    if (!isOnboardingExempt(location.pathname)) {
      const setupState = getSetupState(settings?.settings?.setupState ?? null)
      if (!isOnboardingComplete(setupState)) {
        throw redirect({ to: '/onboarding' })
      }
    }

    // Suspension renders inline in RootComponent rather than redirecting
    // to /suspended — same URL, content reflects state. When CP flips
    // state back to active, the next render shows the actual page
    // without the user having to navigate. Exempt paths (login,
    // oauth callbacks, magic-link landing) skip the inline overlay
    // so suspended owners can still get back in.

    return {
      baseUrl,
      session,
      settings,
      userRole,
      themeCookie,
      managedFieldPaths,
      state,
      registeredAuthProviders,
    }
  },
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        title: 'Quackback',
      },
      {
        name: 'description',
        content: 'Open-source customer feedback platform',
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        name: 'twitter:card',
        content: 'summary',
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
  errorComponent: ({ error, reset }) => (
    <SafeRootDocument>
      <DefaultErrorPage error={error} reset={reset} />
    </SafeRootDocument>
  ),
})

function RootComponent() {
  const ctx = Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const overlayState =
    ctx.state && ctx.state !== 'active' && !isSuspensionExempt(pathname) ? ctx.state : null

  return (
    <RootDocument>
      <OttHandler />
      {overlayState ? <SuspendedView state={overlayState} /> : <Outlet />}
    </RootDocument>
  )
}

/**
 * Wraps RootDocument with a fallback for when route context is unavailable
 * (e.g. when the error occurred during beforeLoad).
 */
function MinimalDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Quackback</title>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  )
}

class SafeRootDocument extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <MinimalDocument>{this.props.children}</MinimalDocument>
    }
    return <RootDocument>{this.props.children}</RootDocument>
  }
}

// Non-portal routes that should never have a forced theme. `/auth/*`
// is intentionally treated as portal-adjacent — its login / signup /
// reset pages match the public portal's branding so visitors don't
// feel like they crossed into a different product.
const NON_PORTAL_PREFIXES = ['/admin', '/onboarding', '/api', '/complete-signup']

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { settings, themeCookie } = Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Portal routes can force a specific theme (light/dark) via branding config.
  // Admin and other non-portal routes always respect the user's preference.
  const isPortalRoute = !NON_PORTAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const themeMode = settings?.brandingConfig?.themeMode ?? 'user'
  const forcedTheme = isPortalRoute && themeMode !== 'user' ? themeMode : undefined

  // next-themes' inline script sets the class on <html> before first paint.
  // We pass the resolved default so the script knows what to apply.
  const defaultTheme = forcedTheme ?? themeCookie ?? 'system'

  return (
    <html suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme={defaultTheme}
          enableSystem={!forcedTheme}
          forcedTheme={forcedTheme}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
