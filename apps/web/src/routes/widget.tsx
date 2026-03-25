import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'
import { WidgetAuthProvider } from '@/components/widget/widget-auth-provider'

const setIframeHeaders = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Content-Security-Policy', 'frame-ancestors *')
  setResponseHeader('X-Frame-Options', 'ALLOWALL')
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

    // If user is logged into the portal, pass their identity (not the token)
    // to the widget so it can exchange for a bearer token client-side.
    // The token is NOT serialized into the HTML — the client fetches it via
    // a server function that reads the session cookie.
    const portalUser =
      session?.user && !session.user.isAnonymous
        ? {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            avatarUrl: session.user.image ?? null,
          }
        : null

    return {
      org,
      brandingData,
      themeMode,
      themeStyles,
      customCss,
      googleFontsUrl: getGoogleFontsUrl(brandingConfig),
      portalUser,
    }
  },
  head: () => ({ meta: [] }),
  component: WidgetLayout,
})

function WidgetLayout() {
  const { themeStyles, customCss, googleFontsUrl, portalUser } = Route.useLoaderData()

  return (
    <WidgetAuthProvider portalUser={portalUser}>
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
