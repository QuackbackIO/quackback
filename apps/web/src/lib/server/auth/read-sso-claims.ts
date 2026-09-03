/**
 * One claim read for the OAuth callback after-hooks.
 *
 * Stash first (what the resolver actually validated this request), then the
 * stored ID token with an expired-token-refusing decode. Shared by role
 * provisioning and claim→attribute writes so a take-once stash cannot starve
 * the second reader.
 */

import { decodeSsoClaims } from './sso-claims-decode'
import { takeResolvedClaims } from './resolved-claims-stash'

/**
 * Read the latest stored ID-token claims for a user's OIDC account.
 * Returns an empty object when no token is stored or the token is
 * malformed — caller should fall back to the legacy auto-provision
 * field in that case.
 *
 * `providerId` is the callback provider's registrationId (the account's
 * `provider_id`). It must match what just authenticated, else the row
 * lookup misses and attribute mapping silently returns {} → default role
 * for every non-`sso` provider.
 */
export async function readSsoClaims(
  userId: `user_${string}`,
  providerId: string
): Promise<Record<string, unknown>> {
  const { db, account, and, eq, desc } = await import('@/lib/server/db')
  const row = await db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, providerId)),
    columns: { idToken: true, accountId: true },
    // Deterministic ordering. There is no uniqueness constraint on
    // (user_id, provider_id), so a duplicate account row — which a change in
    // which claim supplies the account identifier can create — would otherwise
    // leave this reading whichever row the database happened to return, quite
    // possibly a stale one, on every sign-in.
    orderBy: desc(account.createdAt),
  })

  // Prefer what the resolver actually validated this request. The stored ID
  // token is a fallback: a provider resolving identity from userinfo or an
  // access token has none, and would otherwise always land on the default role
  // however its claims are mapped.
  if (row?.accountId) {
    const fresh = takeResolvedClaims(providerId, row.accountId)
    if (fresh) return fresh
  }

  // Refuses an expired token; see sso-claims-decode.ts for why freshness is
  // the property that matters when the signature is not verified.
  return decodeSsoClaims(row?.idToken)
}
