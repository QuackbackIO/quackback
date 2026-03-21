import { createAuthClient } from 'better-auth/client'
import {
  anonymousClient,
  emailOTPClient,
  genericOAuthClient,
  oneTimeTokenClient,
} from 'better-auth/client/plugins'

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
  plugins: [anonymousClient(), emailOTPClient(), genericOAuthClient(), oneTimeTokenClient()],
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
