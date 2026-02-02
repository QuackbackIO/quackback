import { createAuthClient } from 'better-auth/client'
import { emailOTPClient } from 'better-auth/client/plugins'

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
  plugins: [emailOTPClient()],
})

/**
 * Sign out the current user
 * Note: Call router.invalidate() after signOut to update session
 */
export const signOut = authClient.signOut
