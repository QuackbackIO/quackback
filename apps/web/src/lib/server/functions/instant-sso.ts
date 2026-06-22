import { createServerFn } from '@tanstack/react-start'
import { getSession } from '@/lib/server/auth/session'
import { getPublicOidcProviders, getPublicPortalConfig } from '@/lib/server/domains/settings/settings.service'
import { resolveInstantSsoProvider } from '@/lib/server/auth/instant-sso'
import { auth } from '@/lib/server/auth'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { isSafeCallbackUrl } from '@/lib/shared/routing'

/** Server-side: returns { url } to the IdP when instant-SSO applies and the
 *  visitor is anonymous, else null. Caller decides whether to redirect. */
export const resolveInstantSsoRedirectFn = createServerFn({ method: 'GET' })
  .validator((d: { callbackUrl?: string }) => d ?? {})
  .handler(async ({ data }) => {
    // Loop-safety: signed-in users must never be force-redirected to SSO.
    const session = await getSession()
    if (session?.user && session.user.principalType !== 'anonymous') return null

    const [publicProviders, portalConfig] = await Promise.all([
      getPublicOidcProviders(),
      getPublicPortalConfig(),
    ])
    const providerId = resolveInstantSsoProvider({
      publicProviders,
      portalOauth: portalConfig?.oauth ?? {},
    })
    if (!providerId) return null

    const headers = getRequestHeaders()
    const safeCallback = isSafeCallbackUrl(data.callbackUrl) ? data.callbackUrl : '/'
    const result = await auth.api.signInWithOAuth2({
      body: { providerId, callbackURL: safeCallback, disableRedirect: true },
      headers,
    })
    return result?.url ? { url: result.url } : null
  })
