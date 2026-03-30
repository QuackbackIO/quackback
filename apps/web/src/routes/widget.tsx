import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'
import { WidgetAuthProvider } from '@/components/widget/widget-auth-provider'
import { extractSessionTokenFromCookie } from '@/lib/server/functions/portal-session-token'

const setIframeHeaders = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Content-Security-Policy', 'frame-ancestors *')
  setResponseHeader('X-Frame-Options', 'ALLOWALL')
})

/** Extract the signed session cookie for direct widget session reuse (same-origin only). */
export const getPortalSessionToken = createServerFn({ method: 'GET' }).handler(async () => {
  const cookie = getRequestHeaders().get('cookie') ?? ''
  return extractSessionTokenFromCookie(cookie)
})

export const Route = createFileRoute('/widget')({
  loader: async ({ context }) => {
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

    return {
      org,
      brandingData,
      themeMode,
      themeStyles,
      customCss,
      googleFontsUrl: getGoogleFontsUrl(brandingConfig),
      portalUser,
      portalSessionToken,
      hmacRequired: settings?.publicWidgetConfig?.hmacRequired ?? false,
    }
  },
  head: () => ({ meta: [] }),
  component: WidgetLayout,
})

function WidgetLayout() {
  const { themeStyles, customCss, googleFontsUrl, portalUser, portalSessionToken, hmacRequired } =
    Route.useLoaderData()

  return (
    <WidgetAuthProvider
      portalUser={portalUser}
      portalSessionToken={portalSessionToken}
      hmacRequired={hmacRequired}
    >
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
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
