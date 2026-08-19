import { authClient } from '@/lib/client/auth-client'

/**
 * Kick off Better-Auth's EXPLICIT account-link flow for a provider the
 * user just failed to sign in with (`account_not_linked`). Requires an
 * active session; the link callback verifies the IdP email matches the
 * session user's email, but — unlike implicit sign-in linking — does not
 * require the local `emailVerified` flag, because the session itself is
 * the ownership proof.
 *
 * Returns the IdP authorization URL to navigate to, or null when the
 * link couldn't be started (the caller should fall back to its
 * destination — the user is signed in either way).
 */
export async function startProviderLink(args: {
  providerId: string
  providerType: 'oidc' | 'social'
  callbackURL: string
}): Promise<string | null> {
  const result =
    args.providerType === 'oidc'
      ? await authClient.oauth2.link({
          providerId: args.providerId,
          callbackURL: args.callbackURL,
        })
      : await authClient.linkSocial({
          provider: args.providerId,
          callbackURL: args.callbackURL,
        })
  return (result.data as { url?: string } | null)?.url ?? null
}
