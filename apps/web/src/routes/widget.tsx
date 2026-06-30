import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { generateThemeCSS } from '@/lib/shared/theme'
import { resolveLocale } from '@/lib/shared/i18n'
import { WidgetAuthProvider } from '@/components/widget/widget-auth-provider'
import { extractSessionTokenFromCookie } from '@/lib/server/functions/portal-session-token'
import { redactSettingsForClient } from '@/lib/shared/redact-portal-config'

const setIframeHeaders = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Content-Security-Policy', 'frame-ancestors *')
  setResponseHeader('X-Frame-Options', 'ALLOWALL')
})

/**
 * Resolve the widget locale on the server so SSR and hydration agree.
 * The `?locale=` search param wins over the Accept-Language header; both
 * are read server-side because navigator/URL access during render would
 * diverge from SSR and trigger React hydration error #418 (issue #133).
 */
const getWidgetLocale = createServerFn({ method: 'GET' })
  .validator(z.object({ explicitLocale: z.string().optional() }))
  .handler(async ({ data }) => {
    const acceptLanguage = getRequestHeaders().get('accept-language')
    return resolveLocale(acceptLanguage, data.explicitLocale)
  })

/** Extract the signed session cookie for direct widget session reuse (same-origin only). */
export const getPortalSessionToken = createServerFn({ method: 'GET' }).handler(async () => {
  const cookie = getRequestHeaders().get('cookie') ?? ''
  return extractSessionTokenFromCookie(cookie)
})

export const Route = createFileRoute('/widget')({
  // Render the widget on the client only. The iframe gets zero SEO value
  // from SSR, and skipping SSR HTML means there's no hydration step for a
  // CDN script-rewriter (Cloudflare Rocket Loader, Mirage, etc.) to break —
  // it makes the widget CDN-rewrite-proof for self-hosters on any CDN.
  // 'data-only' (not false): the loader must still run on the server so
  // setIframeHeaders() can set frame-ancestors/X-Frame-Options on the
  // document response, and the locale is resolved from Accept-Language.
  ssr: 'data-only',
  validateSearch: (search: Record<string, unknown>): { locale?: string } => ({
    locale: typeof search.locale === 'string' ? search.locale : undefined,
  }),
  loader: async ({ context, location }) => {
    const { settings, session } = context

    const org = settings?.settings
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    await setIframeHeaders()

    const brandingData = settings.brandingData ?? null
    const brandingConfig = settings.brandingConfig ?? {}
    const customCss = settings.customCss ?? ''
    const themeMode = brandingConfig.themeMode ?? 'user'

    const hasThemeConfig = brandingConfig.light || brandingConfig.dark
    const themeStyles = hasThemeConfig ? generateThemeCSS(brandingConfig) : ''

    // If user is logged into the portal (same-origin), extract the signed
    // session cookie so the widget can reuse it directly as a Bearer token.
    // This prevents duplicate anonymous users and bypasses HMAC requirements.
    const portalUser =
      session?.user && session.user.principalType !== 'anonymous'
        ? {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            avatarUrl: session.user.image ?? null,
          }
        : null

    // Extract the signed session cookie during SSR — this is the only point
    // where the cookie is available in cross-origin iframes (SameSite=Lax
    // sends cookies for the initial iframe navigation but NOT for subsequent
    // fetch/XHR from within the iframe). The token in the iframe's serialized
    // HTML is safe: cross-origin parent pages cannot read iframe content.
    const portalSessionToken = session?.user ? await getPortalSessionToken() : null

    // location.search isn't generically typed inside the loader — cast to
    // the validateSearch shape, matching the pattern in _portal/index.tsx.
    const { locale: explicitLocale } = location.search as { locale?: string }
    const locale = await getWidgetLocale({ data: { explicitLocale } })

    return {
      org: redactSettingsForClient(org),
      brandingData,
      themeMode,
      themeStyles,
      customCss,
      portalUser,
      portalSessionToken,
      hmacRequired: settings?.publicWidgetConfig?.hmacRequired ?? false,
      locale,
    }
  },
  head: () => ({ meta: [] }),
  component: WidgetLayout,
})

function WidgetLayout() {
  const { themeStyles, customCss, portalUser, portalSessionToken, hmacRequired, locale } =
    Route.useLoaderData()

  return (
    <WidgetAuthProvider
      portalUser={portalUser}
      portalSessionToken={portalSessionToken}
      hmacRequired={hmacRequired}
      initialLocale={locale}
    >
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            body { overflow: hidden; margin: 0; }
            html, body, #root { height: 100%; }
            /* Prevent white flash before theme resolves */
            html.system { background: #fff; }
            @media (prefers-color-scheme: dark) {
              html.system { background: #09090b; }
            }
          `,
        }}
      />
      <Outlet />
    </WidgetAuthProvider>
  )
}
