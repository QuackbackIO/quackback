import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { readConfigFontSans } from '@/lib/shared/theme'
import { resolveLocale, loadWidgetMessages } from '@/lib/shared/i18n'
import { WidgetAuthProvider } from '@/components/widget/widget-auth-provider'
import { FileViewerProvider } from '@/components/shared/files/file-viewer-context'
import { extractSessionTokenFromCookie } from '@/lib/server/functions/portal-session-token'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { redactSettingsForClient } from '@/lib/shared/redact-portal-config'
import { escapeInlineStyle } from '@/lib/shared/safe-inline-content'
import { Button } from '@/components/ui/button'
import { useBrandingFont } from '@/lib/client/hooks/use-branding-font'
import { isTeamMember } from '@/lib/shared/roles'
import { shouldReusePortalSession } from '@/lib/shared/widget/portal-session-reuse'

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

/**
 * Extract the signed session cookie for direct widget session reuse. Returns
 * null unless the request is the frame's document navigation from a page on
 * the instance's own origin (see shouldReusePortalSession).
 */
export const getPortalSessionToken = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  const reuse = shouldReusePortalSession({
    site: headers.get('sec-fetch-site'),
    mode: headers.get('sec-fetch-mode'),
  })
  if (!reuse) return null
  return extractSessionTokenFromCookie(headers.get('cookie') ?? '')
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
  validateSearch: (
    search: Record<string, unknown>
  ): { locale?: string; theme?: 'light' | 'dark' } => ({
    locale: typeof search.locale === 'string' ? search.locale : undefined,
    // Forces the widget document's theme regardless of visitor preference or
    // branding themeMode. Used by the admin settings preview's Light/Dark
    // toggle; resolved in __root so it never persists to the theme cookie.
    theme: search.theme === 'light' || search.theme === 'dark' ? search.theme : undefined,
  }),
  loader: async ({ context, location }) => {
    const { settings, session, userRole } = context

    const org = settings?.settings
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    await setIframeHeaders()

    const brandingData = settings.brandingData ?? null
    const brandingConfig = settings.brandingConfig ?? {}
    const customCss = settings.customCss ?? ''
    const themeMode = brandingConfig.themeMode ?? 'user'

    // Loaded here, not imported at the top: route loaders stay in the route
    // tree's chunk, which every page loads.
    const { generateWorkspaceThemeCSS } = await import('@/lib/shared/theme/generator')
    const themeStyles = generateWorkspaceThemeCSS(brandingConfig)

    // location.search isn't generically typed inside the loader — cast to
    // the validateSearch shape, matching the pattern in _portal/index.tsx.
    const { locale: explicitLocale } = location.search as { locale?: string }

    // A visitor signed in to the portal keeps that session inside the widget
    // only when the page embedding the frame is the instance's own origin. The
    // session cookie is SameSite=Lax, so it also arrives on frame navigations
    // from other same-site origins (sibling subdomains); getPortalSessionToken
    // returns null for those, and the widget then starts as for an anonymous
    // visitor until the host identifies the user with a signed identity token.
    // The token is read here, during the frame's document request, because
    // later fetches from inside the frame cannot say who embeds it.
    const [portalSessionToken, locale] = await Promise.all([
      session?.user ? getPortalSessionToken() : Promise.resolve(null),
      getWidgetLocale({ data: { explicitLocale } }),
    ])
    const portalUserBase =
      portalSessionToken && session?.user && session.user.principalType !== 'anonymous'
        ? {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            avatarUrl: session.user.image ?? null,
          }
        : null
    const portalAvatar = portalUserBase
      ? await fetchUserAvatar({
          data: { userId: portalUserBase.id, fallbackImageUrl: portalUserBase.avatarUrl },
        })
      : null
    const portalUser = portalUserBase
      ? { ...portalUserBase, avatarUrl: portalAvatar?.avatarUrl ?? portalUserBase.avatarUrl }
      : null
    // Serialize the widget's catalog slice into loader data so the first
    // client render is already translated (the route is ssr: 'data-only' —
    // there's no SSR HTML to seed from).
    const messages = await loadWidgetMessages(locale)

    return {
      org: redactSettingsForClient(org),
      brandingData,
      themeMode,
      themeStyles,
      customCss,
      configFontSans: readConfigFontSans(brandingConfig),
      portalUser,
      portalSessionToken,
      hmacRequired: settings?.publicWidgetConfig?.hmacRequired ?? false,
      canPortalHandoff: !isTeamMember(userRole),
      locale,
      messages,
    }
  },
  head: () => ({ meta: [] }),
  component: WidgetLayout,
  errorComponent: WidgetErrorComponent,
})

/**
 * Compact error fallback for the widget iframe. No marketing chrome or "Go
 * home" link — this renders inside a customer's embedded widget, so it's a
 * small centered message with a retry action.
 */
function WidgetErrorComponent() {
  const router = useRouter()

  return (
    <div className="flex min-h-[200px] items-center justify-center px-4">
      <div className="text-center">
        <p className="text-[13px] text-muted-foreground">Something went wrong.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => router.invalidate()}>
          Retry
        </Button>
      </div>
    </div>
  )
}

function WidgetLayout() {
  const {
    themeStyles,
    customCss,
    configFontSans,
    portalUser,
    portalSessionToken,
    hmacRequired,
    canPortalHandoff,
    locale,
    messages,
  } = Route.useLoaderData()

  // Widget documents render branding fonts the same way the portal does (the
  // custom CSS / theme config font-family cascades into the iframe below) —
  // load the chosen family on demand instead of shipping every self-hosted
  // family's @font-face rules to every embedded widget.
  useBrandingFont(customCss, configFontSans)

  return (
    <WidgetAuthProvider
      portalUser={portalUser}
      portalSessionToken={portalSessionToken}
      hmacRequired={hmacRequired}
      canPortalHandoff={canPortalHandoff}
      initialLocale={locale}
      initialMessages={messages}
    >
      {themeStyles && (
        <style dangerouslySetInnerHTML={{ __html: escapeInlineStyle(themeStyles) }} />
      )}
      {customCss && <style dangerouslySetInnerHTML={{ __html: escapeInlineStyle(customCss) }} />}
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
      <FileViewerProvider compact>
        <Outlet />
      </FileViewerProvider>
    </WidgetAuthProvider>
  )
}
