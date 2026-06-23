import { createServerFn } from '@tanstack/react-start'
import { getSession } from '@/lib/server/auth/session'
import { getPublicAuthConfig } from '@/lib/server/domains/settings/settings.service'
import { isSignInMethodEnabled } from '@/lib/shared/signin-methods'
import {
  getRegisteredAuthProviders,
  getRegisteredOidcProviderIds,
} from '@/lib/server/auth/registered-providers'
import { auth } from '@/lib/server/auth'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { isSafeCallbackUrl } from '@/lib/shared/routing'

/**
 * Server-side: returns `{ url }` to the IdP when the workspace's ONLY sign-in
 * method is a single OIDC provider and the visitor is anonymous, else null.
 * Every sign-in necessarily flows through that one provider, so the portal can
 * redirect straight to it and skip the dialog. The caller decides whether to
 * redirect.
 *
 * "Sole method" is read from the registered-provider view (the same gate the
 * runtime applies), so it covers a routed-only provider with no public button
 * just as well as a public one — and never fires while password / magic-link /
 * social or a *second* IdP is also usable.
 */
export const resolveInstantSsoRedirectFn = createServerFn({ method: 'GET' })
  .validator((d: { callbackUrl?: string }) => d ?? {})
  .handler(async ({ data }) => {
    // Loop-safety: signed-in users must never be force-redirected to SSO.
    const session = await getSession()
    if (session?.user && session.user.principalType !== 'anonymous') return null

    const [registeredOidc, registeredAll, authConfig] = await Promise.all([
      getRegisteredOidcProviderIds(),
      getRegisteredAuthProviders(),
      getPublicAuthConfig(),
    ])
    const oidcIds = [...registeredOidc]
    const passwordEnabled = isSignInMethodEnabled(authConfig?.oauth, 'password')
    const magicLinkEnabled = isSignInMethodEnabled(authConfig?.oauth, 'magicLink')
    // Sole sign-in method: exactly one registered OIDC provider, no registered
    // social provider (`registeredAll` is just that one id), and no built-in
    // email method.
    const providerId =
      oidcIds.length === 1 && registeredAll.length === 1 && !passwordEnabled && !magicLinkEnabled
        ? oidcIds[0]
        : null
    if (!providerId) return null

    const headers = getRequestHeaders()
    const safeCallback = isSafeCallbackUrl(data.callbackUrl) ? data.callbackUrl : '/'
    const result = await auth.api.signInWithOAuth2({
      body: { providerId, callbackURL: safeCallback, disableRedirect: true },
      headers,
    })
    return result?.url ? { url: result.url } : null
  })
