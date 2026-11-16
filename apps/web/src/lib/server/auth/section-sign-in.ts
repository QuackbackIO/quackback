/**
 * Provider sign-in (OAuth, OIDC) started on a section host. The provider's
 * callback is on the primary domain, and the library keeps the sign-in's
 * state in a cookie on the host that started it, so a sign-in started on
 * help.acme.com would come back to acme.com without its state and fail.
 *
 * So the library's `/sign-in/social` answers a section host with the address
 * of SECTION_SIGN_IN_PATH on the primary domain instead of the provider's.
 * The client goes there the way it would have gone to the provider (its popup
 * or the page itself); the sign-in runs on the primary domain and the section
 * handoff brings the session back (lib/shared/section-handoff.ts). Every
 * caller of `signIn.social` gets this for free.
 */
import { getSectionOrigins } from '@/lib/server/domains/settings/section-links'
import { requestWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'
import { normalizeHost } from '@/lib/shared/section-domains'
import { safeHandoffReturnTo, sectionSignInUrl } from '@/lib/shared/section-handoff'
import { sectionServedAt } from '@/lib/shared/section-links'

/** A callback the client sent, as a path on `hereOrigin`, else the home page. */
function pathOnHost(value: unknown, hereOrigin: string): string {
  if (typeof value !== 'string') return '/'
  const relative = safeHandoffReturnTo(value)
  if (relative) return relative
  try {
    const url = new URL(value)
    if (url.origin !== hereOrigin) return '/'
    return safeHandoffReturnTo(`${url.pathname}${url.search}${url.hash}`) ?? '/'
  } catch {
    return '/'
  }
}

export async function sectionSignInMove(ctx: {
  path?: string
  request?: Request
  body?: unknown
}): Promise<{ url: string; redirect: true } | null> {
  if (ctx.path !== '/sign-in/social' || !ctx.request) return null
  const body = (ctx.body ?? {}) as {
    provider?: unknown
    idToken?: unknown
    callbackURL?: unknown
    errorCallbackURL?: unknown
    loginHint?: unknown
  }
  // An id-token sign-in completes in this request; nothing to move.
  if (body.idToken || typeof body.provider !== 'string' || !body.provider) return null

  const host = normalizeHost(requestWorkspaceHost(ctx.request))
  const origins = await getSectionOrigins()
  const section = sectionServedAt(host, origins)
  if (!host || !section) return null

  const hereOrigin = origins[section]
  return {
    url: sectionSignInUrl({
      primaryOrigin: origins.primary,
      hereHost: host,
      provider: body.provider,
      returnTo: pathOnHost(body.callbackURL, hereOrigin),
      errorReturnTo: pathOnHost(body.errorCallbackURL ?? body.callbackURL, hereOrigin),
      ...(typeof body.loginHint === 'string' && body.loginHint
        ? { loginHint: body.loginHint }
        : {}),
    }),
    redirect: true,
  }
}
