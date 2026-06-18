import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { PortalHeader } from '@/components/public/portal-header'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { PortalAccessGate } from '@/components/portal/portal-access-gate'
import type { PortalAccessGateError } from '@/lib/shared/types/portal-gate-error'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { getPortalLocaleFn, loadPortalIntl } from '@/lib/server/functions/locale'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import {
  evaluateMyPortalAccessFn,
  recordPortalAccessDeniedFn,
} from '@/lib/server/functions/portal-access'
import { redactSettingsForClient } from '@/lib/shared/redact-portal-config'

export const Route = createFileRoute('/_portal')({
  loader: async ({ context }) => {
    const { session, settings, userRole, baseUrl } = context

    // Portal-level visibility gate — evaluated here in the loader (NOT
    // beforeLoad) so the post-sign-in router.invalidate() re-runs it and the
    // gate clears the instant the visitor becomes authorized. A beforeLoad
    // result is cached across invalidate for an already-loaded match, which
    // would otherwise strand the just-signed-in visitor on the gate.
    //
    // On denial we render the sign-in wall from the component at HTTP 200 (the
    // right status for a login screen — not the 404/500 a throw would force, and
    // no error/notFound console noise). Not throwing means the child loaders
    // still run, but nothing leaks: every public portal read fn independently
    // gates on resolvePortalAccessForRequest() and returns empty for a blocked
    // visitor (defense in depth). The decision is computed server-side
    // (session + allowedDomains never leave the server); only it is returned.
    const accessResult = await evaluateMyPortalAccessFn()
    if (!accessResult.granted) {
      // OWASP authz_fail — emit only for authenticated denials (anonymous
      // denials are too noisy). Best-effort, fire-and-forget.
      const isAuthenticated = !!session?.user && session.user.principalType !== 'anonymous'
      if (isAuthenticated) {
        void recordPortalAccessDeniedFn({ data: { reason: accessResult.reason } }).catch(() => {})
      }

      const org = settings?.settings
      const brandingData = settings?.brandingData ?? null
      const brandingConfig = settings?.brandingConfig ?? {}
      const hasThemeConfig = brandingConfig.light || brandingConfig.dark
      // Locale so the gate's auth dialog renders under PortalIntlProvider.
      const locale = await getPortalLocaleFn().catch(() => DEFAULT_LOCALE)
      const gate: PortalAccessGateError = {
        type: 'portal-access-gate',
        reason: accessResult.reason,
        workspaceName: org?.name ?? '',
        logoUrl: brandingData?.logoUrl ?? null,
        themeStyles: hasThemeConfig ? generateThemeCSS(brandingConfig) : '',
        customCss: settings?.customCss ?? '',
        locale,
        // Only meaningful for 'unauthorized' — null for an anonymous visitor.
        // Lets the overlay say "you're signed in as alice@…, but…".
        userEmail: accessResult.reason === 'unauthorized' ? (session?.user?.email ?? null) : null,
        authConfig: {
          found: !!settings?.publicPortalConfig,
          oauth: settings?.publicPortalConfig?.oauth ?? DEFAULT_PORTAL_CONFIG.oauth,
          customProviderNames: settings?.publicPortalConfig?.customProviderNames,
        },
      }
      return { gate }
    }

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

    const { locale, messages } = await loadPortalIntl()

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
      messages,
      gate: null,
    }
  },
  head: ({ loaderData }) => {
    // Access gate: a valid 200 sign-in page, but keep it out of search indexes.
    if (loaderData?.gate) {
      return {
        meta: [
          { title: `Sign in · ${loaderData.gate.workspaceName}` },
          { name: 'robots', content: 'noindex, nofollow' },
        ],
        links: [{ rel: 'icon', href: loaderData.gate.logoUrl || '/logo.png' }],
      }
    }

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
  component: PortalLayout,
})

function PortalLayout() {
  const loaderData = Route.useLoaderData()

  // Access denied: render the in-place sign-in wall (a normal 200 page). The
  // gate is self-contained (it mounts its own PortalIntlProvider).
  if (loaderData.gate) {
    const gate = loaderData.gate
    return (
      <PortalAccessGate
        reason={gate.reason}
        workspaceName={gate.workspaceName}
        logoUrl={gate.logoUrl}
        authConfig={gate.authConfig}
        themeStyles={gate.themeStyles}
        customCss={gate.customCss}
        userEmail={gate.userEmail ?? null}
        locale={gate.locale}
      />
    )
  }

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
    messages,
  } = loaderData

  return (
    <PortalIntlProvider locale={locale} messages={messages}>
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
