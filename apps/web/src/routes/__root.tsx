/// <reference types="vite/client" />
import { Component, type ReactNode } from 'react'
import type { Role } from '@/lib/shared/roles'
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
import { resolveDocumentTheme } from '@/lib/shared/theme'
import { Toaster } from '@/components/ui/sonner'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { OttHandler } from '@/components/shared/ott-handler'
import { VisitorBeacon } from '@/components/shared/visitor-beacon'
import { documentLocale, htmlLangDir } from '@/lib/shared/document-locale'
import { normalizeLocale, DEFAULT_LOCALE, type SupportedLocale } from '@/lib/shared/i18n'

export interface RouterContext {
  queryClient: QueryClient
  baseUrl?: string
  session?: BootstrapData['session']
  settings?: TenantSettings | null
  userRole?: Role | null
  themeCookie?: BootstrapData['themeCookie']
  prefersColorScheme?: BootstrapData['prefersColorScheme']
  managedFieldPaths?: string[]
  registeredAuthProviders?: string[]
  acceptLanguageLocale?: SupportedLocale
  updateBannerDismissedVersion?: BootstrapData['updateBannerDismissedVersion']
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

export function isOnboardingExempt(pathname: string): boolean {
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
      prefersColorScheme,
      managedFieldPaths,
      registeredAuthProviders,
      acceptLanguageLocale,
      updateBannerDismissedVersion,
    } = await getBootstrapData()

    if (!isOnboardingExempt(location.pathname)) {
      const setupState = getSetupState(settings?.settings?.setupState ?? null)
      if (!isOnboardingComplete(setupState)) {
        throw redirect({ to: '/onboarding' })
      }
    }

    // Redact server-only material from the settings placed into the router
    // context — everything returned here is dehydrated into the SSR HTML.
    // redactSettingsForClient strips the widgetSecret/tier/setup columns from
    // the raw row and the access policy fields (allowedDomains, widgetSignIn,
    // allowedSegmentIds) from portalConfig, recursively covering both the
    // parsed TenantSettings shape and the raw DB row riding on `.settings`.
    // Nothing on the client legitimately reads any of it — the admin
    // Security → Portal tab fetches the full config via its own
    // settingsQueries.portalConfig() query, which is unaffected, and the
    // domain gate runs server-side via evaluateMyPortalAccessFn.
    const redactedSettings: TenantSettings | null = settings
      ? (redactSettingsForClient(settings) as TenantSettings)
      : settings

    // Drop the raw DB row entirely from the client-bound context. Redaction
    // already stripped its secrets, but the row is a full duplicate of the
    // parsed TenantSettings fields (name, slug, portalConfig, brandingConfig,
    // …) that no client code reads — every consumer reads the parsed top-level
    // fields instead. Emptying it removes one whole settings copy per SSR
    // document. The only server-side readers of `settings.settings.*` are the
    // onboarding routes (name/slug), which now read the parsed top-level
    // `settings.name`/`settings.slug`, and the pre-redaction setupState read at
    // line 72 above, which runs on the un-emptied `settings` and is unaffected.
    if (redactedSettings) {
      redactedSettings.settings = {}
    }

    return {
      baseUrl,
      session,
      settings: redactedSettings,
      userRole,
      themeCookie,
      prefersColorScheme,
      managedFieldPaths,
      registeredAuthProviders,
      acceptLanguageLocale,
      updateBannerDismissedVersion,
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
  return (
    <RootDocument>
      <OttHandler />
      <VisitorBeacon />
      <Outlet />
    </RootDocument>
  )
}

/**
 * Wraps RootDocument with a fallback for when route context is unavailable
 * (e.g. when the error occurred during beforeLoad).
 */
function MinimalDocument({ children }: Readonly<{ children: ReactNode }>) {
  // No route context here, so the theme is unknown — fall back to the same
  // OS-driven canvas the helper uses for `system`, so the error page doesn't
  // white-flash either.
  const { colorScheme } = resolveDocumentTheme('system')
  return (
    <html lang="en" style={{ colorScheme }} suppressHydrationWarning>
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
  const { settings, themeCookie, prefersColorScheme, acceptLanguageLocale } =
    Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // structuralSharing keeps the array reference stable across store updates that
  // don't change the matched routes, so RootDocument doesn't re-render every tick.
  const routeIds = useRouterState({
    select: (s) => s.matches.map((m) => m.routeId),
    structuralSharing: true,
  })
  // The widget honors a `?locale=` override (its SDK appends it); read it so the
  // iframe document advertises the widget's actual language, not just the
  // Accept-Language one. Only the widget route reads this param.
  const widgetLocaleParam = useRouterState({
    select: (s) => (s.location.search as { locale?: string }).locale,
  })
  // The widget and portal both honor a `?theme=` override (the admin settings
  // previews append it): forced for that document only, never persisted to the
  // cookie.
  const themeParam = useRouterState({
    select: (s) => (s.location.search as { theme?: string }).theme,
  })

  // Portal routes can force a specific theme (light/dark) via branding config.
  // Admin and other non-portal routes always respect the user's preference.
  const isPortalRoute = !NON_PORTAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const themeMode = settings?.brandingConfig?.themeMode ?? 'user'
  const searchForcedTheme =
    (routeIds.includes('/widget') || isPortalRoute) &&
    (themeParam === 'light' || themeParam === 'dark')
      ? themeParam
      : undefined
  const forcedTheme =
    searchForcedTheme ?? (isPortalRoute && themeMode !== 'user' ? themeMode : undefined)

  // next-themes' inline script sets the class on <html> before first paint.
  // We pass the resolved default so the script knows what to apply.
  const defaultTheme = forcedTheme ?? themeCookie ?? 'system'

  // ...but the script can't color the very first canvas the browser paints
  // during load, so when the theme is known we also commit the class and
  // color-scheme on the SSR <html> — otherwise dark users get a white flash.
  // `system` is resolved from the Sec-CH-Prefers-Color-Scheme hint when the
  // browser sent it, so even system users get a fully server-rendered theme.
  const { className: themeClass, colorScheme } = resolveDocumentTheme(
    defaultTheme,
    prefersColorScheme
  )

  // Advertise the rendered language on the document during SSR so non-English
  // visitors don't get an English `<html lang>` (and so RTL locales aren't laid
  // out LTR until hydration). Decided from the matched route IDs so only
  // actually-localized routes are tagged; see documentLocale. On the widget a
  // valid `?locale=` override wins, matching what the widget itself renders.
  const widgetOverride =
    routeIds.includes('/widget') && widgetLocaleParam ? normalizeLocale(widgetLocaleParam) : null
  const resolvedLocale = widgetOverride ?? acceptLanguageLocale ?? DEFAULT_LOCALE
  const { lang, dir } = htmlLangDir(documentLocale(routeIds, resolvedLocale))

  // suppressHydrationWarning stays: next-themes' inline script sets the theme
  // class on <html> before React hydrates, and for `system` without the client
  // hint (Firefox/Safari) the server can't know the OS preference, so the SSR
  // markup and the hydrated DOM differ by design. This silences that one
  // expected mismatch (one element, one level).
  return (
    <html
      lang={lang}
      dir={dir}
      className={themeClass}
      style={{ colorScheme }}
      suppressHydrationWarning
    >
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
          // Never write the shared theme cookie from a forced-theme document:
          // the widget iframe and the same-origin portal preview iframe would
          // otherwise flip the admin's own theme.
          syncCookie={!routeIds.includes('/widget') && !searchForcedTheme}
        >
          {children}
          <Toaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
