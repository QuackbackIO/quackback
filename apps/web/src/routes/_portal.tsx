import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { PortalHeader } from '@/components/public/portal-header'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { PortalAccessGate } from '@/components/portal/portal-access-gate'
import { type PortalAccessGateError, parseGateError } from '@/lib/shared/types/portal-gate-error'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'
import { resolveLocale } from '@/lib/shared/i18n'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import {
  evaluateMyPortalAccessFn,
  recordPortalAccessDeniedFn,
} from '@/lib/server/functions/portal-access'
import { redactSettingsForClient } from '@/lib/shared/redact-portal-config'

/** Resolve locale from Accept-Language header on the server. */
const getPortalLocale = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const acceptLanguage = getRequestHeaders().get('accept-language')
  return resolveLocale(acceptLanguage)
})

export const Route = createFileRoute('/_portal')({
  beforeLoad: async ({ context }) => {
    const { settings } = context

    // Portal-level visibility gate.
    // Throwing here — in beforeLoad — sets firstBadMatchIndex, which aborts
    // all child route loaders. No portal data is fetched or dehydrated for a
    // blocked visitor. (A throw from loader does not abort child loaders.)
    //
    // The access decision is evaluated server-side by evaluateMyPortalAccessFn,
    // which reads the caller's session and the full portal config (including
    // allowedDomains) entirely on the server. Only the decision is returned —
    // allowedDomains and widgetSignIn never touch the client context.
    const accessResult = await evaluateMyPortalAccessFn()

    if (!accessResult.granted) {
      // OWASP authz_fail — emit only for authenticated denials (anonymous denials
      // are too noisy and lower-signal). Best-effort, never blocks the gate throw.
      const session = context.session
      const isAuthenticated = !!session?.user && session.user.principalType !== 'anonymous'
      if (isAuthenticated) {
        // Best-effort, fire-and-forget. The server fn handles all server-only
        // imports + actor resolution + the audit emit. `.catch()` suppresses
        // the unhandled-rejection so the gate throw below is never affected.
        void recordPortalAccessDeniedFn({ data: { reason: accessResult.reason } }).catch(() => {})
      }

      // Both denied cases (unauthenticated + unauthorized) render an in-place
      // overlay via the route's errorComponent. The gate payload is carried
      // two ways so it survives SSR serialization — see parseGateError below.
      const org = settings?.settings
      const brandingData = settings?.brandingData ?? null
      const brandingConfig = settings?.brandingConfig ?? {}
      const hasThemeConfig = brandingConfig.light || brandingConfig.dark
      const gateError: PortalAccessGateError = {
        type: 'portal-access-gate',
        reason: accessResult.reason,
        workspaceName: org?.name ?? '',
        logoUrl: brandingData?.logoUrl ?? null,
        themeStyles: hasThemeConfig ? generateThemeCSS(brandingConfig) : '',
        customCss: settings?.customCss ?? '',
        // Only meaningful for the 'unauthorized' branch — null when the
        // visitor is anonymous. The overlay uses this to say "you're
        // signed in as alice@gmail.com, but…" so the admin can sign out
        // and try a different account.
        userEmail: accessResult.reason === 'unauthorized' ? (session?.user?.email ?? null) : null,
        authConfig: {
          found: !!settings?.publicPortalConfig,
          oauth: settings?.publicPortalConfig?.oauth ?? DEFAULT_PORTAL_CONFIG.oauth,
          customProviderNames: settings?.publicPortalConfig?.customProviderNames,
        },
      }
      throw Object.assign(new Error(JSON.stringify(gateError)), gateError)
    }
  },
  loader: async ({ context }) => {
    const { session, settings, userRole, baseUrl } = context

    const org = settings?.settings
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    // userRole comes from bootstrap data, avatar needs to be fetched
    const avatarData = session?.user
      ? await fetchUserAvatar({
          data: { userId: session.user.id, fallbackImageUrl: session.user.image },
        })
      : null

    const brandingData = settings?.brandingData ?? null
    const faviconData = settings?.faviconData ?? null
    const brandingConfig = settings?.brandingConfig ?? {}
    const customCss = settings?.customCss ?? ''
    const publicPortalConfig = settings?.publicPortalConfig ?? null

    const themeMode = brandingConfig.themeMode ?? 'user'

    // Always generate CSS from theme config (if structured vars exist)
    const hasThemeConfig = brandingConfig.light || brandingConfig.dark
    const themeStyles = hasThemeConfig ? generateThemeCSS(brandingConfig) : ''

    // Always apply custom CSS on top (cascades over theme styles)
    const customCssToApply = customCss

    // Always load Google Fonts from theme config
    const googleFontsUrl = getGoogleFontsUrl(brandingConfig)

    const initialUserData = session?.user
      ? {
          name: session.user.name,
          email: session.user.email,
          avatarUrl: avatarData?.avatarUrl ?? null,
        }
      : undefined

    const authConfig = {
      found: true,
      oauth: publicPortalConfig?.oauth ?? DEFAULT_PORTAL_CONFIG.oauth,
      customProviderNames: publicPortalConfig?.customProviderNames,
    }

    const locale = await getPortalLocale()

    return {
      org: redactSettingsForClient(org),
      baseUrl: baseUrl ?? '',
      userRole,
      session,
      brandingData,
      faviconData,
      themeStyles,
      customCss: customCssToApply,
      themeMode,
      googleFontsUrl,
      initialUserData,
      authConfig,
      locale,
    }
  },
  head: ({ loaderData }) => {
    // Favicon priority: dedicated favicon > workspace logo > default logo.png
    const faviconUrl =
      loaderData?.faviconData?.url || loaderData?.brandingData?.logoUrl || '/logo.png'

    const workspaceName = loaderData?.org?.name ?? 'Quackback'
    const description = `Share feedback, vote on feature requests, and track the ${workspaceName} roadmap.`
    const logoUrl = loaderData?.brandingData?.logoUrl || '/logo.png'

    const meta: Array<Record<string, string>> = [
      { title: workspaceName },
      { name: 'description', content: description },
      { property: 'og:site_name', content: workspaceName },
      { property: 'og:title', content: workspaceName },
      { property: 'og:description', content: description },
      { property: 'og:image', content: logoUrl },
      { name: 'twitter:title', content: workspaceName },
      { name: 'twitter:description', content: description },
    ]
    return {
      meta,
      links: [{ rel: 'icon', href: faviconUrl }],
    }
  },
  errorComponent: PortalErrorBoundary,
  component: PortalLayout,
})

/**
 * Catches errors thrown from the _portal loader. When the error is a
 * PortalAccessGateError we render the in-place overlay; anything else falls
 * through to the default error UI.
 *
 * The gate data is carried two ways so it survives SSR serialization:
 *   1. As extra properties on the Error object (works in pure client / dev).
 *   2. As JSON in the error message (survives when only message is preserved).
 */
function PortalErrorBoundary({ error }: { error: unknown; reset?: () => void }) {
  const gateErr = parseGateError(error)
  if (gateErr) {
    return (
      <PortalAccessGate
        reason={gateErr.reason}
        workspaceName={gateErr.workspaceName}
        logoUrl={gateErr.logoUrl}
        authConfig={gateErr.authConfig}
        themeStyles={gateErr.themeStyles}
        customCss={gateErr.customCss}
        userEmail={gateErr.userEmail ?? null}
      />
    )
  }
  // Unknown error — do not surface raw error.message (may contain internal detail).
  return (
    <div className="flex min-h-screen items-center justify-center p-8 text-center">
      <p className="text-muted-foreground">Something went wrong. Please try again.</p>
    </div>
  )
}

function PortalLayout() {
  const loaderData = Route.useLoaderData()
  const {
    org,
    userRole,
    brandingData,
    themeStyles,
    customCss,
    themeMode,
    googleFontsUrl,
    initialUserData,
    authConfig,
    locale,
  } = loaderData

  return (
    <PortalIntlProvider locale={locale}>
      <AuthPopoverProvider>
        <div className="min-h-screen bg-background flex flex-col">
          {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
          {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
          {/* Custom CSS is injected after theme styles so it can override */}
          {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
          <PortalHeader
            orgName={org.name}
            orgLogo={brandingData?.logoUrl ?? null}
            userRole={userRole}
            initialUserData={initialUserData}
            showThemeToggle={themeMode === 'user'}
          />
          <main className="flex-1 w-full flex flex-col">
            <Outlet />
          </main>
          <AuthDialog authConfig={authConfig} workspaceName={org.name} />
        </div>
      </AuthPopoverProvider>
    </PortalIntlProvider>
  )
}
