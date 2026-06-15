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
import { redactSettingsForClient } from '@/lib/shared/redact-portal-config'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { OttHandler } from '@/components/shared/ott-handler'
import { SuspendedView } from '@/components/shared/suspended-view'
import { isSuspensionExempt } from '@/lib/server/middleware/suspension-paths'
import { documentLocale } from '@/lib/shared/document-locale'
import { isRtlLocale, isRtlForced, DEFAULT_LOCALE, type SupportedLocale } from '@/lib/shared/i18n'

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
  acceptLanguageLocale?: SupportedLocale
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
      acceptLanguageLocale,
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

    // Redact allowedDomains and widgetSignIn from the portalConfig placed
    // into the router context. Both fields are server-only policy: the
    // domain gate now runs server-side via evaluateMyPortalAccessFn.
    // Nothing on the client legitimately reads them from context —
    // the admin Security → Portal tab fetches the full config via its own
    // settingsQueries.portalConfig() query, which is unaffected.
    //
    // Two locations are redacted:
    //   1. settings.portalConfig (parsed PortalConfig object on TenantSettings).
    //   2. settings.settings.portalConfig (raw DB row JSON string) — child loaders
    //      that pass `settings` or `settings.settings` into their SSR payload would
    //      otherwise carry the full access config in the dehydrated context.
    const redactedSettings: TenantSettings | null = settings
      ? ({
          ...settings,
          // 1. Parsed config on TenantSettings
          portalConfig: settings.portalConfig?.access
            ? {
                ...settings.portalConfig,
                access: {
                  // Only expose visibility — keep allowedDomains and widgetSignIn off the wire.
                  visibility: settings.portalConfig.access.visibility,
                },
              }
            : settings.portalConfig,
          // 2. Raw DB row — portalConfig column is a JSON string; redact inline.
          settings: redactSettingsForClient(settings.settings as Record<string, unknown>),
        } as TenantSettings)
      : settings

    return {
      baseUrl,
      session,
      settings: redactedSettings,
      userRole,
      themeCookie,
      managedFieldPaths,
      state,
      registeredAuthProviders,
      acceptLanguageLocale,
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
  const { settings, themeCookie, acceptLanguageLocale } = Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Portal routes can force a specific theme (light/dark) via branding config.
  // Admin and other non-portal routes always respect the user's preference.
  const isPortalRoute = !NON_PORTAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const themeMode = settings?.brandingConfig?.themeMode ?? 'user'
  const forcedTheme = isPortalRoute && themeMode !== 'user' ? themeMode : undefined

  // next-themes' inline script sets the class on <html> before first paint.
  // We pass the resolved default so the script knows what to apply.
  const defaultTheme = forcedTheme ?? themeCookie ?? 'system'

  // Advertise the rendered language on the document during SSR so non-English
  // visitors don't get an English `<html lang>` (and so RTL locales aren't laid
  // out LTR until hydration). The admin app stays English; see documentLocale.
  const htmlLocale = documentLocale(pathname, acceptLanguageLocale ?? DEFAULT_LOCALE)
  const dir = isRtlForced() || isRtlLocale(htmlLocale) ? 'rtl' : 'ltr'

  return (
    <html lang={htmlLocale} dir={dir} suppressHydrationWarning>
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
