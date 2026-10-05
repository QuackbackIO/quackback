/// <reference types="vite/client" />
import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import type { Role } from '@/lib/shared/roles'
import type { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createRootRouteWithContext,
  redirect,
  rootRouteId,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { isAdmin } from '@/lib/shared/roles'
import appCss from '../globals.css?url'
import { getBootstrapData, type BootstrapData } from '@/lib/server/functions/bootstrap'
import { createRouteContextMemo } from '@/lib/client/route-context-memo'
import type { WorkspaceSettings } from '@/lib/shared/types/settings'
import { ThemeProvider } from '@/components/theme-provider'
import { resolveDocumentTheme, SYSTEM_THEME_SCRIPT } from '@/lib/shared/theme'
import { MinimalDocument } from '@/components/shared/minimal-document'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { DocumentHead, DocumentScripts } from '@/components/shared/document-head'
import { OttHandler } from '@/components/shared/ott-handler'
import { VisitorBeacon } from '@/components/shared/visitor-beacon'
import { ProductAnalytics } from '@/components/shared/product-analytics'
import { documentLocale, htmlLangDir } from '@/lib/shared/document-locale'
import { normalizeLocale, DEFAULT_LOCALE, type SupportedLocale } from '@/lib/shared/i18n'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

// The toast renderer is its own chunk: the root module ships with every
// document (the embedded widget included), and a toast fired before it mounts
// is replayed to it once it subscribes.
const Toaster = lazy(() => import('@/components/ui/sonner').then((m) => ({ default: m.Toaster })))

export interface RouterContext {
  queryClient: QueryClient
  baseUrl?: string
  session?: BootstrapData['session']
  settings?: WorkspaceSettings | null
  userRole?: Role | null
  themeCookie?: BootstrapData['themeCookie']
  prefersColorScheme?: BootstrapData['prefersColorScheme']
  managedFieldPaths?: string[]
  registeredAuthProviders?: string[]
  acceptLanguageLocale?: SupportedLocale
  updateBannerDismissedVersion?: BootstrapData['updateBannerDismissedVersion']
  billingEnabled?: boolean
  cloudEnabled?: boolean
  productAnalytics?: BootstrapData['productAnalytics']
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
  '/e2e/',
]

export function isOnboardingExempt(pathname: string): boolean {
  return ONBOARDING_EXEMPT_PATHS.some((path) => pathname.startsWith(path))
}

// The settings arrive already redacted: getBootstrapData scrubs them on the
// server, since its response also answers client-side navigations.
async function loadRootContext() {
  const { settings, ...bootstrap } = await getBootstrapData()
  return { ...bootstrap, settings }
}

type RootContext = Awaited<ReturnType<typeof loadRootContext>>

/**
 * The root context is the same for every page until the viewer or the
 * workspace changes, so navigations and preloads share one bootstrap call
 * (see route-context-memo.ts for what expires it).
 */
const rootContext = createRouteContextMemo<RootContext>()

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }) => {
    const context = await rootContext.get(loadRootContext)
    const { session, userRole, onboarding } = context

    if (!isOnboardingExempt(location.pathname)) {
      if (!onboarding.complete) {
        throw redirect({ to: '/onboarding' })
      }
      // A provisioned workspace can look complete while the owner has not
      // chosen a name, URL, or goal. Visitors stay on the portal; only a
      // signed-in admin is sent into the wizard.
      if (session?.user && isAdmin(userRole) && onboarding.needsSetupWizard) {
        throw redirect({ to: '/onboarding' })
      }
    }

    return context
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
      <ProductAnalytics />
      <Outlet />
    </RootDocument>
  )
}

/**
 * Wraps RootDocument with a fallback for when route context is unavailable
 * (e.g. when the error occurred during beforeLoad).
 */
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

/**
 * The first navigation after hydration reuses the context this document was
 * rendered with instead of asking the server again. Read once, when the
 * document mounts: the memo keeps only the first answer it is given. An error
 * page rendered because the bootstrap failed has none to reuse.
 */
function useSeedRootContext() {
  const router = useRouter()
  useEffect(() => {
    const root = router.state.matches.find((match) => match.routeId === rootRouteId)
    if (!root) return
    const { queryClient: _queryClient, ...rendered } = root.context as RouterContext &
      Partial<RootContext>
    if (rendered.onboarding) rootContext.seed(rendered as RootContext)
  }, [router])
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  // Every read below is selected: the context and the location are new after
  // every navigation, and the document changes only when what it shows does.
  const settings = useWorkspaceSettings()
  const themeCookie = Route.useRouteContext({ select: (context) => context.themeCookie })
  const prefersColorScheme = Route.useRouteContext({
    select: (context) => context.prefersColorScheme,
  })
  const acceptLanguageLocale = Route.useRouteContext({
    select: (context) => context.acceptLanguageLocale,
  })
  useSeedRootContext()
  // Portal routes can force a specific theme (light/dark) via branding config.
  // Admin and other non-portal routes always respect the user's preference.
  const isPortalRoute = useRouterState({
    select: (s) => !NON_PORTAL_PREFIXES.some((prefix) => s.location.pathname.startsWith(prefix)),
  })
  const isWidgetRoute = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId === '/widget'),
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

  const themeMode = settings?.brandingConfig?.themeMode ?? 'user'
  const searchForcedTheme =
    (isWidgetRoute || isPortalRoute) && (themeParam === 'light' || themeParam === 'dark')
      ? themeParam
      : undefined
  const forcedTheme =
    searchForcedTheme ?? (isPortalRoute && themeMode !== 'user' ? themeMode : undefined)

  // next-themes' inline script sets the class on <html> before first paint.
  // We pass the resolved default so the script knows what to apply.
  const defaultTheme = forcedTheme ?? themeCookie ?? 'system'

  // ...but that script sits in <body>, after content that may paint first, so
  // when the theme is known we also commit the class and color-scheme on the
  // SSR <html>, or dark users get a white flash. `system` is resolved
  // from the Sec-CH-Prefers-Color-Scheme hint when the browser sent it; when
  // it did not, SYSTEM_THEME_SCRIPT resolves it at the top of <head>, before
  // any of the body can paint.
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
    isWidgetRoute && widgetLocaleParam ? normalizeLocale(widgetLocaleParam) : null
  const resolvedLocale = widgetOverride ?? acceptLanguageLocale ?? DEFAULT_LOCALE
  const locale = useRouterState({
    select: (s) =>
      documentLocale(
        s.matches.map((m) => m.routeId),
        resolvedLocale
      ),
  })
  const { lang, dir } = htmlLangDir(locale)

  // suppressHydrationWarning stays: the inline theme scripts set the class on
  // <html> before React hydrates, and for `system` without the client hint
  // (a first visit, Firefox/Safari) the server can't know the OS preference,
  // so the SSR markup and the hydrated DOM differ by design. This silences
  // that one expected mismatch (one element, one level).
  return (
    <html
      lang={lang}
      dir={dir}
      className={themeClass}
      style={{ colorScheme }}
      suppressHydrationWarning
    >
      <head>
        {!themeClass && <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />}
        <DocumentHead />
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
          syncCookie={!isWidgetRoute && !searchForcedTheme}
        >
          {children}
          <Suspense fallback={null}>
            <Toaster locale={locale} />
          </Suspense>
        </ThemeProvider>
        <DocumentScripts />
      </body>
    </html>
  )
}
