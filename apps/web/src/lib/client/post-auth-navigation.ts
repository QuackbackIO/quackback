import { isTeamCallback } from '@/lib/shared/routing'

/**
 * Navigate to a post-sign-in destination.
 *
 * Team surfaces (e.g. `/admin`) live OUTSIDE the portal shell, so they are
 * reached with a FULL navigation rather than a client-side route change:
 *   - it re-bootstraps the admin app already authenticated (no stale
 *     logged-out router context), and
 *   - it avoids the client-side route change colliding with the portal
 *     header's post-login `router.invalidate()` — both fire on the same
 *     auth-success broadcast, and tearing down `/` while navigating away from
 *     it blanks the page mid-transition.
 *
 * Portal-local destinations stay client-side via the provided `clientNavigate`.
 */
export function navigateAfterAuth(callbackUrl: string, clientNavigate: () => void): void {
  if (isTeamCallback(callbackUrl)) {
    window.location.assign(callbackUrl)
  } else {
    clientNavigate()
  }
}
