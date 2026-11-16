/**
 * Provider sign-in (OAuth, OIDC) started on a section host. The provider's
 * callback is on the primary domain, and the library keeps the sign-in's
 * state in a cookie on the host that started it, so a sign-in started on
 * help.acme.com would come back to acme.com without its state and fail.
 *
 * So the library's `/sign-in/social` answers a section host with the address
 * of SECTION_SIGN_IN_PATH on the primary domain instead of the provider's.
 * The client goes there the way it would have gone to the provider (its popup
 * or the page itself). `startSectionSignIn` answers there: it starts the
 * provider sign-in on the primary domain, with a callback that is the section
 * handoff back to the section host (lib/shared/section-handoff.ts). Every
 * caller of `signIn.social` gets this for free.
 */
import { getSectionOrigins } from '@/lib/server/domains/settings/section-links'
import { logger } from '@/lib/server/logger'
import { requestWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'
import { normalizeHost } from '@/lib/shared/section-domains'
import {
  handoffReturnTo,
  safeHandoffReturnTo,
  sectionHandoffUrl,
  sectionSignInUrl,
} from '@/lib/shared/section-handoff'
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

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/**
 * SECTION_SIGN_IN_PATH, on the primary domain. `to` must be a routable
 * section host of this workspace, checked here against the same table links
 * and routing use; anything else starts nothing and stays on this host. The
 * library sets its state cookie on this response, so it lands on this host,
 * where the provider's callback reads it.
 */
export async function startSectionSignIn(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const origins = await getSectionOrigins()
  const host = normalizeHost(requestWorkspaceHost(request))
  const primaryHost = normalizeHost(new URL(origins.primary).host)
  const section = sectionServedAt(url.searchParams.get('to'), origins)
  const provider = url.searchParams.get('provider')
  if (!host || host !== primaryHost || !section || !provider) return redirect('/')

  const target = origins[section]
  const returnTo = handoffReturnTo(url.searchParams.get('returnTo'))
  const errorCallbackURL = `${target}${handoffReturnTo(
    url.searchParams.get('errorReturnTo') ?? returnTo
  )}`
  const loginHint = url.searchParams.get('loginHint')
  try {
    const { auth } = await import('@/lib/server/auth')
    const response = (await auth.api.signInSocial({
      body: {
        provider,
        callbackURL: sectionHandoffUrl({ targetOrigin: target, fromHost: host, returnTo }),
        errorCallbackURL,
        ...(loginHint ? { loginHint } : {}),
        disableRedirect: true,
      },
      headers: request.headers,
      asResponse: true,
    })) as Response
    const body = response.ok ? ((await response.json()) as { url?: unknown }) : null
    if (typeof body?.url === 'string') {
      return redirect(body.url, response.headers.getSetCookie())
    }
  } catch (err) {
    logger
      .child({ component: 'section-sign-in' })
      .warn(
        { error_name: err instanceof Error ? err.name : typeof err },
        'provider sign-in not started'
      )
  }
  return redirect(errorCallbackURL)
}
