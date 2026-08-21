import { createFileRoute } from '@tanstack/react-router'
import { requestEmailSignin } from '@/lib/server/auth/email-signin'
import { checkMagicLinkSendRateLimit } from '@/lib/server/auth/signin-rate-limit'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { AUTH_BLOCK_MESSAGES } from '@/lib/shared/auth-block-messages'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'portal-signin' })

interface PortalSigninBody {
  email?: unknown
  callbackURL?: unknown
}

/**
 * Is this thrown value a limiter refusing, and what did it say to wait?
 *
 * Better-Auth raises `APIError('TOO_MANY_REQUESTS', …, { 'Retry-After': … })`
 * from inside its own middleware chain, so a limiter reached below this handler
 * surfaces as a throw rather than a return value. Matched structurally rather
 * than with `instanceof`: the error crosses a package boundary, and a class
 * identity check that silently stops matching would turn every throttle back
 * into a 500 with nothing failing.
 *
 * `headers` is whatever the thrower passed — a plain object here, a `Headers`
 * where the chain has merged one — so both are read.
 */
function asRateLimited(err: unknown): { retryAfter: string | null } | null {
  const e = err as { statusCode?: unknown; status?: unknown; headers?: unknown }
  const throttled = e?.statusCode === 429 || e?.status === 'TOO_MANY_REQUESTS'
  if (!throttled) return null
  const headers = e.headers
  if (headers instanceof Headers) return { retryAfter: headers.get('Retry-After') }
  if (headers && typeof headers === 'object') {
    const value = (headers as Record<string, unknown>)['Retry-After']
    return { retryAfter: typeof value === 'string' ? value : null }
  }
  return { retryAfter: null }
}

/**
 * POST /api/auth/portal-signin
 *
 * Triggers a passwordless sign-in email containing both a magic link and a
 * 6-digit OTP. The frontend then shows the OTP input as primary; users can also
 * click the link in the email.
 *
 * ## Two properties this handler owns
 *
 * **It is metered, once.** Everything downstream that used to do the metering
 * sits behind a Better-Auth endpoint the signup policy can decide not to reach
 * — so without a limiter here, an unauthenticated caller could ask this
 * question about an unlimited number of addresses for free. The limiter runs
 * before the workspace is even read, so every address costs the same budget
 * whatever the answer turns out to be.
 *
 * "Once" is half the property and the easier half to lose: a downstream call
 * that re-enters the `hooks.before` chain spends the same bucket again, which
 * makes the answer that gets that far twice as expensive as the answer that
 * does not. `requestEmailSignin` mints through the endpoint that has no such
 * chain for exactly this reason.
 *
 * **It answers the same way to everyone.** One status, one body, for an address
 * that holds an account, an address somebody invited, and an address the
 * workspace has never heard of. `requestEmailSignin` carries the whole decision
 * and reports nothing back for this handler to branch on; the refusal is
 * delivered to the address itself. A 4xx for the refused case would have been a
 * free, unauthenticated account-existence oracle, and the invitation exemption
 * would have made it an oracle for "invited but not yet joined" as well.
 *
 * Exported so it can be driven directly: a handler that can only be reached
 * through the router is a handler nobody can hold two requests up against.
 */
export async function handlePortalSignin(request: Request): Promise<Response> {
  let body: PortalSigninBody
  try {
    body = (await request.json()) as PortalSigninBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.email !== 'string' || !body.email.includes('@')) {
    return Response.json({ error: 'Valid email required' }, { status: 400 })
  }
  const callbackURL = typeof body.callbackURL === 'string' ? body.callbackURL : '/'
  const email = body.email.trim().toLowerCase()

  // Same limiter and same keyspace as the Better-Auth send paths, so asking
  // here is not a way around the budget that applies there. Fails open when
  // the bucket store is unreachable, matching every other limiter in this app.
  const limit = await checkMagicLinkSendRateLimit(getClientIp(request), email).catch((err) => {
    log.error({ err }, 'portal signin rate-limit check threw; failing open')
    return { allowed: true as const, retryAfter: undefined }
  })
  if (!limit.allowed) {
    return Response.json(
      { error: AUTH_BLOCK_MESSAGES.rate_limited, code: 'rate_limited' },
      {
        status: 429,
        headers: limit.retryAfter ? { 'Retry-After': String(limit.retryAfter) } : undefined,
      }
    )
  }

  try {
    await requestEmailSignin({ email, callbackURL })
    return Response.json({ ok: true })
  } catch (err) {
    // A limiter saying no is an expected answer, not a fault, and it arrives as
    // a thrown `TOO_MANY_REQUESTS` when it is raised anywhere downstream rather
    // than by the check above. Reported as a 500 it loses its `Retry-After`,
    // and "Didn't get the email? Resend" reads as the workspace being broken.
    // Answered here in the same shape the check above uses, so a caller cannot
    // tell which of the two refused.
    const throttled = asRateLimited(err)
    if (throttled) {
      return Response.json(
        { error: AUTH_BLOCK_MESSAGES.rate_limited, code: 'rate_limited' },
        {
          status: 429,
          headers: throttled.retryAfter ? { 'Retry-After': throttled.retryAfter } : undefined,
        }
      )
    }
    log.error({ err }, 'portal signin failed')
    // A fixed string, not `err.message`. Everything reachable from here is a
    // failure of this workspace rather than a fact about the address, and an
    // error text that varied would be the same differential the rest of this
    // handler exists to remove — plus a way to read internals out of a 500.
    return Response.json({ error: 'Failed to send sign-in email' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/auth/portal-signin')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePortalSignin(request),
    },
  },
})
