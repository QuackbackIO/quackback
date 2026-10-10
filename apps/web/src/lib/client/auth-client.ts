// Browser-safe better-auth client — re-exported here so client code
// does not reach into lib/server/
import { authClient } from '@/lib/server/auth/client'
import { expireRouteContext } from './route-context-memo'

export { authClient, signOut, hasSession } from '@/lib/server/auth/client'

// Better Auth flips this signal after every call that changes the session
// (sign-in, sign-out, a second factor, a profile update). The route context
// navigations reuse carries the session, so it must not outlive one, even
// where the caller does not go on to invalidate the router.
if (typeof window !== 'undefined') {
  authClient.$store.atoms.$sessionSignal?.listen(() => expireRouteContext())
}
