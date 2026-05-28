import { createAuthClient } from 'better-auth/client'
import {
  anonymousClient,
  emailOTPClient,
  genericOAuthClient,
  magicLinkClient,
  oneTimeTokenClient,
  twoFactorClient,
} from 'better-auth/client/plugins'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import { SESSION_TOKEN_COOKIE_NAME } from '@/lib/shared/auth-cookie'

/**
 * sessionStorage key for the post-2FA destination URL.
 *
 * Better-Auth's twoFactor plugin server returns `{ twoFactorRedirect: true }`
 * but does NOT echo back the request's `callbackURL` field (verified
 * against `node_modules/.bun/better-auth@1.6.5/.../two-factor/index.mjs`
 * line ~256, which returns only `twoFactorRedirect` + `twoFactorMethods`).
 * Likewise the client-side `onTwoFactorRedirect` hook only sees
 * `{ twoFactorMethods }` (see `client.d.mts` in the same package). The
 * original request body is invisible to both.
 *
 * So login forms stash the desired post-auth destination here before
 * calling `signIn.email`. The twoFactorClient redirect handler reads it
 * and forwards as `?callbackURL=` on the `/auth/two-factor` URL; the
 * route then consumes that param (with a `/`-prefix safety check) on
 * successful verification and clears the key.
 */
export const TWO_FACTOR_CALLBACK_STORAGE_KEY = 'quackback:auth.callback-url'

/**
 * Best-effort SSR-safe stash for the callback URL — silently no-ops on
 * the server and when sessionStorage is unavailable (private mode in
 * some browsers).
 */
export function stashTwoFactorCallbackUrl(url: string | undefined): void {
  if (typeof window === 'undefined') return
  try {
    if (isSafeCallbackUrl(url)) {
      window.sessionStorage.setItem(TWO_FACTOR_CALLBACK_STORAGE_KEY, url)
    } else {
      window.sessionStorage.removeItem(TWO_FACTOR_CALLBACK_STORAGE_KEY)
    }
  } catch {
    /* sessionStorage disabled — fall back to the route default. */
  }
}

function readTwoFactorCallbackUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.sessionStorage.getItem(TWO_FACTOR_CALLBACK_STORAGE_KEY)
    return isSafeCallbackUrl(value) ? value : null
  } catch {
    return null
  }
}

export function clearTwoFactorCallbackUrl(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(TWO_FACTOR_CALLBACK_STORAGE_KEY)
  } catch {
    /* nothing to clear */
  }
}

/**
 * Resolve the post-2FA destination from the route's search params.
 *
 * Accepts both `callbackURL` (Better-Auth convention, matches
 * `signIn.email({ callbackURL })`) and the legacy `callbackUrl` so
 * existing links keep working. Returns the first same-origin candidate
 * — see `isSafeCallbackUrl` in `lib/shared/routing` — so a poisoned
 * link can't bounce the user offsite.
 */
export function resolveTwoFactorDest(
  search: { callbackURL?: string; callbackUrl?: string } | undefined
): string {
  if (!search) return '/'
  if (isSafeCallbackUrl(search.callbackURL)) return search.callbackURL
  if (isSafeCallbackUrl(search.callbackUrl)) return search.callbackUrl
  return '/'
}

/**
 * Better-auth client for client-side authentication
 * Used in React components for auth actions
 *
 * For TanStack Start integration:
 * - Session is fetched server-side in root loader
 * - Access session via route context: Route.useRouteContext()
 * - Use router.invalidate() to refetch session after auth actions
 *
 * Note: No baseURL needed - Better Auth client defaults to current origin
 */
export const authClient = createAuthClient({
  plugins: [
    anonymousClient(),
    emailOTPClient(),
    genericOAuthClient(),
    magicLinkClient(),
    oneTimeTokenClient(),
    twoFactorClient({
      // We register `onTwoFactorRedirect` instead of `twoFactorPage` so
      // we can splice the stashed callbackURL onto the destination —
      // Better-Auth's built-in handler hard-codes the URL with no
      // query-string. Falls back to `/auth/two-factor` with no params
      // when nothing's stashed.
      onTwoFactorRedirect: () => {
        if (typeof window === 'undefined') return
        const stashed = readTwoFactorCallbackUrl()
        const dest = stashed
          ? `/auth/two-factor?callbackURL=${encodeURIComponent(stashed)}`
          : '/auth/two-factor'
        window.location.href = dest
      },
    }),
  ],
})

/**
 * Sign out the current user.
 *
 * Layered approach (both fire, the order matters):
 *  1. Mark silent SSO as suppressed in **sessionStorage** so the
 *     in-flight `useSilentSso` hook in this tab can't race against
 *     the signout navigation. Tab-scoped on purpose — cross-tab +
 *     cross-restart protection comes from step (3) actually
 *     destroying the IdP session, so a `prompt=none` retry in
 *     another tab returns `login_required` cleanly. Making this
 *     flag durable was a previous attempt at defense-in-depth that
 *     turned out to permanently block silent SSO for anyone who
 *     ever signed out — see `use-silent-sso.ts` for the legacy
 *     localStorage flag cleanup.
 *  2. Clear the Better-Auth session cookie via `authClient.signOut`.
 *  3. If the workspace has SSO configured AND the IdP advertises an
 *     `end_session_endpoint` in its discovery doc, top-window-
 *     navigate to it with `client_id` + `post_logout_redirect_uri`
 *     set. The IdP destroys its session and bounces back to
 *     `/auth/sso-logout-complete`, which forwards to `/auth/login`.
 *     This is the spec'd RP-Initiated Logout flow — the only way
 *     to actually end the cross-app SSO session.
 *
 * If RP-initiated logout fails (no SSO configured, discovery fetch
 * fails, IdP doesn't publish `end_session_endpoint`), we fall back
 * to a Quackback-only signout. In that degraded mode silent SSO
 * WILL pick the user up again on the next page load via the
 * still-alive IdP session — which is correct behavior for a Quack-
 * back-only logout: the IdP session is the cross-app source of
 * truth, and a local-only signout shouldn't trump it.
 *
 * Note: callers that need to invalidate the router AFTER local
 * signout (admin sidebar, etc.) should still call
 * `router.invalidate()` themselves. When RP-initiated logout is
 * available we navigate away before that runs, which is fine —
 * the post-logout landing page is fresh-loaded.
 */
export const signOut: typeof authClient.signOut = async (...args) => {
  if (typeof window !== 'undefined') {
    try {
      // Timestamp — `useSilentSso` checks against a TTL so the
      // flag expires on its own (see SUPPRESSED_TTL_MS). Without
      // this, a user who signs out and later signs back in via the
      // IdP in another tab would stay stuck signed-out on refreshes
      // of this tab until they closed it.
      window.sessionStorage.setItem('quackback.sso.suppressed', String(Date.now()))
      window.sessionStorage.removeItem('quackback.sso.attempted')
    } catch {
      /* storage disabled — `useSilentSso`'s in-memory guard still
         catches us within a single load. */
    }
  }

  const result = await authClient.signOut(...args)

  // RP-initiated logout — best-effort. If the server fn returns null
  // (no SSO, no end_session_endpoint, fetch failure) we just leave
  // the user on whatever page the caller's redirect takes them to;
  // suppression from step (1) keeps them safe either way.
  if (typeof window !== 'undefined') {
    try {
      const { getSsoLogoutUrlFn } = await import('@/lib/server/functions/sso-logout')
      const info = await getSsoLogoutUrlFn()
      if (info?.url) {
        window.location.href = info.url
      }
    } catch {
      /* swallow — caller's local-redirect path keeps working. */
    }
  }

  return result
}

/**
 * Check if the browser has an active session cookie.
 * SSR-safe — returns false on the server.
 *
 * Note: Better Auth sets HttpOnly on session cookies, so document.cookie
 * cannot read them. This function serves as a best-effort check for
 * non-HttpOnly cookies (e.g. widget identify endpoint sets its own).
 * For portal components, prefer checking the session from route context.
 *
 * The substring match against the bare prefix-included name covers
 * both the http (`quackback.session_token`) and https
 * (`__Secure-quackback.session_token`) variants in one check.
 */
export function hasSession(): boolean {
  return typeof document !== 'undefined' && document.cookie.includes(SESSION_TOKEN_COOKIE_NAME)
}
