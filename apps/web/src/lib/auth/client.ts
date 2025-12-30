import { createAuthClient } from 'better-auth/client'

/**
 * Better-auth client for client-side authentication
 * Used in React components for auth actions
 *
 * For TanStack Start integration:
 * - Session is fetched server-side in root loader
 * - Access session via route context: Route.useRouteContext()
 * - Use router.invalidate() to refetch session after auth actions
 */
export const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL || '',
})

/**
 * Sign out the current user
 * Note: Call router.invalidate() after signOut to update session
 */
export const signOut = authClient.signOut
