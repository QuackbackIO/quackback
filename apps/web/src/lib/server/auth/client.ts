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
 * Sign out the current user
 * Note: Call router.invalidate() after signOut to update session
 */
export const signOut = authClient.signOut

/**
 * Check if the browser has an active session cookie.
 * SSR-safe — returns false on the server.
 *
 * Note: Better Auth sets HttpOnly on session cookies, so document.cookie
 * cannot read them. This function serves as a best-effort check for
 * non-HttpOnly cookies (e.g. widget identify endpoint sets its own).
 * For portal components, prefer checking the session from route context.
 */
export function hasSession(): boolean {
  return typeof document !== 'undefined' && document.cookie.includes('better-auth.session_token')
}
