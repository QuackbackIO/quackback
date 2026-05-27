import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

/**
 * Landing page hit by the IdP after RP-initiated logout completes.
 *
 * The flow is:
 *   1. User clicks "Sign out" in Quackback.
 *   2. `signOut()` clears the Quackback session cookie via
 *      Better-Auth, sets `quackback.sso.suppressed` in localStorage,
 *      and top-window-navigates to the IdP's `end_session_endpoint`
 *      with `post_logout_redirect_uri=<this route>`.
 *   3. The IdP clears its own session and 302s back here.
 *   4. This page shows a brief "Signed out" confirmation and
 *      forwards to `/auth/login`. The suppression flag prevents
 *      `useSilentSso` (which mounts on `/auth/login`) from
 *      immediately re-signing the user back in.
 *
 * The redirect is JS-driven so we can show the confirmation card
 * for ~1.2s rather than flashing past the user instantly. The page
 * is reachable without authentication on purpose — it's the
 * post-logout state.
 */
export const Route = createFileRoute('/auth/sso-logout-complete')({
  component: SsoLogoutCompletePage,
})

const REDIRECT_DELAY_MS = 1200

function SsoLogoutCompletePage() {
  useEffect(() => {
    const timeout = setTimeout(() => {
      // Use location.replace so the back button doesn't bring the
      // user back to the post-logout screen.
      window.location.replace('/auth/login')
    }, REDIRECT_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8">
        <CheckCircleIcon className="h-12 w-12 text-green-500 mx-auto" />
        <p className="text-foreground font-medium">Signed out</p>
        <p className="text-sm text-muted-foreground">Redirecting to sign-in…</p>
      </div>
    </div>
  )
}
