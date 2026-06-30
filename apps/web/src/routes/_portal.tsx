import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { PortalHeader } from '@/components/public/portal-header'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { PortalAccessGate } from '@/components/portal/portal-access-gate'
import type { PortalAccessGateError } from '@/lib/shared/types/portal-gate-error'
import { DEFAULT_AUTH_CONFIG } from '@/lib/shared/types/settings'
import { generateThemeCSS } from '@/lib/shared/theme'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { getPortalLocaleFn, loadPortalIntl } from '@/lib/server/functions/locale'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import {
  evaluateMyPortalAccessFn,
  recordPortalAccessDeniedFn,
} from '@/lib/server/functions/portal-access'
import { redactSettingsForClient } from '@/lib/shared/redact-portal-config'
import { parseAuthPromptSearch } from '@/lib/shared/auth-prompt'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import { useAutoOpenAuthDialog } from '@/components/auth/use-auto-open-auth'
import { resolveInstantSsoRedirectFn } from '@/lib/server/functions/instant-sso'

export const Route = createFileRoute('/_portal')({
  // Only type the auth-prompt keys; child routes receive their own params from
  // the raw URL independently (TanStack Router does not chain parent
  // validateSearch into child validateSearch).
  //
  // Return type uses optional keys (?: not T|undefined) so that `{}` satisfies
  // the schema — TanStack Router's IsRequiredParams checks `{} extends TParams`
  // and only makes `search` required when the schema has required keys.
  validateSearch: (
    search: Record<string, unknown>
  ): {
    auth?: string
    callbackUrl?: string
    error?: string
  } => ({
    auth:
      search.auth === 'signin' || search.auth === 'signup' ? (search.auth as string) : undefined,
    callbackUrl: isSafeCallbackUrl(search.callbackUrl) ? (search.callbackUrl as string) : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  loaderDeps: ({ search }) => ({
    auth: search.auth,
    callbackUrl: search.callbackUrl,
    error: search.error,
  }),
  loader: async ({ context, deps, location }) => {
    const { session, settings, userRole, baseUrl, registeredAuthProviders } = context

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
    // Parse the portal-route auth-prompt params (signin, prompt, callbackUrl)
    // once; both the blocked-gate and the accessible branch below consume it.
    const prompt = parseAuthPromptSearch(deps ?? {})
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
      // Instant-SSO: when the workspace's only sign-in method is a single OIDC
      // provider, redirect anonymous visitors straight to the IdP. Skipped for
      // 'unauthorized' (signed-in non-member) — they already have a session and
      // a force-redirect would be wrong. Skipped when an `error` is present: an
      // IdP-rejected sign-in bounces back to `?error=…`, and re-redirecting to
      // the IdP would loop instead of surfacing the error. /auth/recovery is
      // the standalone break-glass for an admin who can't use the IdP.
      if (accessResult.reason === 'unauthenticated' && !prompt.error) {
        const instant = await resolveInstantSsoRedirectFn({
          // Fall back to the requested deep link so a sole-IdP redirect returns
          // the user to the private route they asked for, not the portal root.
          data: { callbackUrl: prompt.callbackUrl ?? location?.pathname },
        })
        if (instant) throw redirect({ href: instant.url })
      }
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
        callbackUrl: prompt.callbackUrl,
        autoOpenSignin: prompt.mode,
        authConfig: {
          found: !!settings?.publicPortalConfig,
          oauth: settings?.publicAuthConfig?.oauth ?? DEFAULT_AUTH_CONFIG.oauth,
          oidcProviders: settings?.publicPortalConfig?.oidcProviders,
          registeredAuthProviders,
          twoFactorRequired: settings?.publicAuthConfig?.twoFactor?.required ?? false,
        },
      }
      return { gate, prompt }
    }

    const org = settings?.settings
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    // Sole-IdP shortcut: a sign-in request (?auth=signin/signup) on an
    // accessible portal redirects straight to the only provider, server-side —
    // no dialog. Skipped when an `error` is present so an IdP-rejected sign-in
    // surfaces the error instead of looping back to the IdP. The fn no-ops for
    // signed-in users and multi-method setups; /auth/recovery is the break-glass.
    if (prompt.mode && !prompt.error) {
      const instant = await resolveInstantSsoRedirectFn({
        // Fall back to the current path so the IdP returns the user where they
        // were, not the portal root.
        data: { callbackUrl: prompt.callbackUrl ?? location.pathname },
      })
      if (instant) throw redirect({ href: instant.url })
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

    const initialUserData = session?.user
      ? {
          name: session.user.name,
          email: session.user.email,
          avatarUrl: avatarData?.avatarUrl ?? null,
        }
      : undefined

    const authConfig = {
      found: true,
      oauth: settings?.publicAuthConfig?.oauth ?? DEFAULT_AUTH_CONFIG.oauth,
      oidcProviders: publicPortalConfig?.oidcProviders,
      registeredAuthProviders,
      twoFactorRequired: settings?.publicAuthConfig?.twoFactor?.required ?? false,
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
      initialUserData,
      authConfig,
      locale,
      messages,
      prompt,
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
        callbackUrl={gate.callbackUrl}
        autoOpenSignin={gate.autoOpenSignin}
      />
    )
  }

  const {
    org,
    userRole,
    session,
    brandingData,
    themeStyles,
    customCss,
    themeMode,
    initialUserData,
    authConfig,
    locale,
    messages,
    prompt,
  } = loaderData

  const isAuthenticated = !!session?.user && session.user.principalType !== 'anonymous'

  return (
    <PortalIntlProvider locale={locale} messages={messages}>
      <AuthPopoverProvider>
        <PortalAuthAutoOpen
          mode={prompt.mode}
          callbackUrl={prompt.callbackUrl}
          error={prompt.error}
          isAuthenticated={isAuthenticated}
        />
        <div className="min-h-screen bg-background flex flex-col">
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

/** Mounts inside AuthPopoverProvider so the hook can access its context. */
function PortalAuthAutoOpen(props: {
  mode?: 'login' | 'signup'
  callbackUrl?: string
  error?: string
  isAuthenticated: boolean
}) {
  useAutoOpenAuthDialog(props)
  return null
}
