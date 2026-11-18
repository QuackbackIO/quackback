/**
 * Linking a provider (OAuth, OIDC) to an account, started on a section host.
 * The provider's callback is on the primary domain, and the library keeps the
 * link's state in a cookie on the host that started it, so a link started on
 * help.acme.com would come back to acme.com without its state and fail.
 *
 * So the link takes a round trip through the primary domain:
 *
 *   1. The library's `/link-social` on a section host, asked by a signed-in
 *      visitor, answers with SECTION_LINK_PATH on the primary domain instead of
 *      the provider's address (`sectionLinkMove`). The client goes there the
 *      way it would have gone to the provider. Every caller of `linkSocial`
 *      gets this for free.
 *   2. SECTION_LINK_PATH on the primary domain (`startSectionLink`). Signed
 *      out there: the section handoff signs the visitor in on the primary
 *      domain and lands back here, once. Signed in: the link starts here, where
 *      its callback and state cookie live, and the provider returns the
 *      visitor to the section page they started from.
 *
 * What each property rests on:
 *
 *  - Hosts. `to` must be a routable section host of this workspace
 *    (`getSignInSectionOrigins`: kept-only hosts are not), and the second leg
 *    runs only on the primary domain. Return paths are same-origin relative
 *    paths (`handoffReturnTo`), joined to `to`'s origin: never an open redirect.
 *  - The right account. The address is signed (HMAC with the workspace secret)
 *    over the user who asked and every field, and checked against the user
 *    signed in on the primary domain. Someone else signed in there is refused,
 *    so the provider is never linked to the wrong account, and an address made
 *    for one person, or edited, starts nothing for another.
 *  - Nothing secret moves. The address carries no session and no user id; the
 *    session on the primary domain is a new one, made by the section handoff.
 *  - Short life. The address works for LINK_TTL_MS.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSessionFromCtx } from 'better-auth/api'
import { getSignInSectionOrigins } from '@/lib/server/domains/settings/section-links'
import { logger } from '@/lib/server/logger'
import { activeSecretKey } from '@/lib/server/secret-key'
import { requestWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'
import { normalizeHost } from '@/lib/shared/section-domains'
import {
  handoffReturnTo,
  sectionHandoffUrl,
  sectionLinkUrl,
  type SectionLinkRequest,
} from '@/lib/shared/section-handoff'
import { sectionServedAt } from '@/lib/shared/section-links'
import { pathOnHost } from './section-sign-in'

const log = logger.child({ component: 'section-link' })

/** Long enough for a handoff and a slow click, short enough to be useless later. */
const LINK_TTL_MS = 10 * 60 * 1000

const SIGNATURE_TAG = 'section-link:v1\n'

/** Marks the return from the handoff, so a handoff that failed is not tried again. */
const HANDED_PARAM = 'handed'

function signature(userId: string, request: SectionLinkRequest): string {
  const payload = JSON.stringify([
    userId,
    request.provider,
    request.to,
    request.returnTo,
    request.errorReturnTo,
    request.expires,
  ])
  return createHmac('sha256', activeSecretKey())
    .update(SIGNATURE_TAG + payload)
    .digest('base64url')
}

function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
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

type LinkSocialContext = Parameters<typeof getSessionFromCtx>[0] & {
  path?: string
  request?: Request
  body?: unknown
}

/**
 * Step 1, in the library's before hook. `/link-social` asked for on a section
 * host by a signed-in visitor: the address of the link on the primary domain,
 * else null and the library answers as usual.
 */
export async function sectionLinkMove(
  ctx: LinkSocialContext
): Promise<{ url: string; redirect: true } | null> {
  if (ctx.path !== '/link-social' || !ctx.request) return null
  const body = (ctx.body ?? {}) as {
    provider?: unknown
    idToken?: unknown
    callbackURL?: unknown
    errorCallbackURL?: unknown
  }
  // An id-token link completes in this request; nothing to move.
  if (body.idToken || typeof body.provider !== 'string' || !body.provider) return null

  const host = normalizeHost(requestWorkspaceHost(ctx.request))
  const origins = await getSignInSectionOrigins()
  const section = sectionServedAt(host, origins)
  if (!host || !section) return null

  // Signed out here: the library refuses it as it would anywhere.
  const signedIn = await getSessionFromCtx(ctx).catch(() => null)
  const userId = signedIn?.user?.id
  if (!userId) return null

  const hereOrigin = origins[section]
  const request: SectionLinkRequest = {
    provider: body.provider,
    to: host,
    returnTo: handoffReturnTo(pathOnHost(body.callbackURL, hereOrigin)),
    errorReturnTo: handoffReturnTo(
      pathOnHost(body.errorCallbackURL ?? body.callbackURL, hereOrigin)
    ),
    expires: Date.now() + LINK_TTL_MS,
  }
  return {
    url: sectionLinkUrl(origins.primary, request, signature(userId, request)),
    redirect: true,
  }
}

async function primarySession(
  headers: Headers
): Promise<{ userId: string; scope: unknown } | null> {
  try {
    const { auth } = await import('@/lib/server/auth')
    const found = await auth.api.getSession({ headers })
    const userId = found?.user?.id
    if (!userId) return null
    return { userId, scope: (found.session as { scope?: unknown }).scope }
  } catch (err) {
    log.warn(
      { error_name: err instanceof Error ? err.name : typeof err },
      'session lookup failed; treating the viewer as signed out'
    )
    return null
  }
}

/**
 * Step 2, SECTION_LINK_PATH on the primary domain. Anything that is not a
 * link for a routable section host of this workspace starts nothing and stays
 * on this host; anything else that goes wrong lands on the section page's
 * error return.
 */
export async function startSectionLink(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const params = url.searchParams
  const origins = await getSignInSectionOrigins()
  const host = normalizeHost(requestWorkspaceHost(request))
  const primaryHost = normalizeHost(new URL(origins.primary).host)
  const to = normalizeHost(params.get('to'))
  const section = sectionServedAt(to, origins)
  const provider = params.get('provider')
  if (!host || host !== primaryHost || !to || !section || !provider) {
    log.info({ reason: 'not_a_workspace_host' }, 'provider link not started')
    return redirect('/')
  }

  const target = origins[section]
  const linkRequest: SectionLinkRequest = {
    provider,
    to,
    returnTo: handoffReturnTo(params.get('returnTo')),
    errorReturnTo: handoffReturnTo(params.get('errorReturnTo')),
    expires: Number(params.get('expires')),
  }
  const errorURL = `${target}${linkRequest.errorReturnTo}`
  const refuse = (reason: string) => {
    log.info({ reason }, 'provider link not started')
    return redirect(errorURL)
  }
  if (!Number.isSafeInteger(linkRequest.expires) || linkRequest.expires <= Date.now()) {
    return refuse('expired')
  }

  const viewer = await primarySession(request.headers)
  if (!viewer || viewer.scope === 'widget') {
    // Back from a handoff that could not sign them in: stop, never loop.
    if (params.has(HANDED_PARAM)) return refuse('not_signed_in')
    const back = new URLSearchParams(params)
    back.set(HANDED_PARAM, '1')
    return redirect(
      sectionHandoffUrl({
        targetOrigin: origins.primary,
        fromHost: to,
        returnTo: `${url.pathname}?${back.toString()}`,
      })
    )
  }

  if (!sameSignature(params.get('sig') ?? '', signature(viewer.userId, linkRequest))) {
    // Edited, or made for someone other than who is signed in here.
    return refuse('not_this_user')
  }

  try {
    const { auth } = await import('@/lib/server/auth')
    const response = (await auth.api.linkSocialAccount({
      body: {
        provider,
        callbackURL: `${target}${linkRequest.returnTo}`,
        errorCallbackURL: errorURL,
        disableRedirect: true,
      },
      headers: request.headers,
      asResponse: true,
    })) as Response
    const body = response.ok ? ((await response.json()) as { url?: unknown }) : null
    if (typeof body?.url === 'string' && body.url) {
      return redirect(body.url, response.headers.getSetCookie())
    }
  } catch (err) {
    log.warn({ error_name: err instanceof Error ? err.name : typeof err }, 'link call failed')
  }
  return refuse('link_refused')
}
