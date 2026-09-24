/**
 * The current request's identity, resolved once.
 *
 * Several independent paths ask who the caller is during one request: the
 * bootstrap payload, the portal-access gate, the auth helpers behind every
 * server function and the session helper the rest of them use. They all ask
 * here, and this runs the Better Auth session lookup and the principal read at
 * most once per request.
 *
 * Every read is memoized for the current request only (`auth-request-cache.ts`),
 * partitioned by workspace, and taken from the request's own headers, so
 * nothing crosses a request, a user or a workspace. Cookie and Bearer
 * credentials resolve exactly as a direct `auth.api.getSession` call would, and
 * the session's `scope` still says which audience it belongs to.
 *
 * What the memo holds is the identity as the request first saw it. A write
 * that changes it, followed by a read in the same request, forgets it in
 * between, and the two ways that happen are already wired:
 *
 * - every in-process Better Auth endpoint other than `/get-session` (sign-in,
 *   sign-out, password and email changes, session revocation, account
 *   linking) forgets the whole identity from the after-hook in `hooks.ts`;
 * - deleting a principal's cache key forgets that principal (`cacheDel` in
 *   `cache.ts`), and every role and type mutation already deletes it.
 *
 * Better Auth may write while resolving a session (sliding the expiry past
 * `updateAge`, clearing a stale cookie). Those writes happen on the first
 * resolution, whose Set-Cookie headers reach the response exactly as before; a
 * repeat lookup in the same request would have found nothing left to do.
 */
import type { UserId } from '@quackback/ids'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { auth } from '@/lib/server/auth/index'
import { db, principal, eq, type Principal } from '@/lib/server/db'
import { CACHE_KEYS } from '@/lib/server/cache'
import {
  forgetPerRequestPrefix,
  memoizePerRequest,
  rememberPerRequest,
} from '@/lib/server/functions/auth-request-cache'

export type RequestSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

/** Memo keys derived from the session share this prefix, so one forget drops them all. */
export const IDENTITY_MEMO_PREFIX = 'identity:'

const SESSION_KEY = `${IDENTITY_MEMO_PREFIX}session`

/**
 * The Better Auth session for this request's credentials (cookie or Bearer),
 * or null. A lookup failure rejects, as `auth.api.getSession` does, and is not
 * memoized; callers keep their own failure policy.
 */
export function getRequestSession(): Promise<RequestSession | null> {
  return memoizePerRequest(SESSION_KEY, async () => {
    // Lazy: the auth instance's module graph stays out of every importer.
    const { auth } = await import('@/lib/server/auth/index')
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    return session ?? null
  })
}

/**
 * The principal row for `userId`, or null when the user has none yet. Keyed by
 * the principal's cache key, so the invalidation every principal mutation
 * already issues also drops it here.
 */
export function getRequestPrincipal(userId: UserId): Promise<Principal | null> {
  return memoizePerRequest(CACHE_KEYS.PRINCIPAL_BY_USER(userId), async () => {
    const record = await db.query.principal.findFirst({ where: eq(principal.userId, userId) })
    return record ?? null
  })
}

/** Serve `record` to the rest of the request, e.g. after creating it. */
export function rememberRequestPrincipal(record: Principal): void {
  if (record.userId) rememberPerRequest(CACHE_KEYS.PRINCIPAL_BY_USER(record.userId), record)
}

/** Forget the session, every principal and everything derived from them. */
export function forgetRequestIdentity(): void {
  forgetPerRequestPrefix(IDENTITY_MEMO_PREFIX)
  forgetPerRequestPrefix(CACHE_KEYS.PRINCIPAL_BY_USER(''))
}
