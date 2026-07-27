/**
 * Decode the stored ID token that drives SSO role provisioning.
 *
 * The signature is deliberately not verified: this token was received
 * first-hand from the IdP's token endpoint over TLS and persisted by us, and
 * the production sign-in path decodes id_tokens the same way. Possession is the
 * trust anchor. What DOES matter here is freshness.
 *
 * `account.id_token` is never cleared, and the library's refresh path filters
 * `undefined` out of its account update, so once an IdP stops issuing an ID
 * token the last one persists indefinitely. That was inert while a missing ID
 * token also meant no sign-in — but exposing a scopes control lets an admin
 * drop `openid`, and unifying identity resolution lets sign-in succeed without
 * one. Together those would let a months-old token keep re-applying an elevated
 * role on every sign-in, and revoking the group upstream would never demote.
 *
 * Refusing an expired token falls back to the provider's default role, which is
 * the safe direction.
 */

/**
 * Claims from a stored ID token, or `{}` when it is absent, malformed, or
 * expired. `now` is injected so the rule is testable without faking timers.
 */
export function decodeSsoClaims(
  idToken: string | null | undefined,
  now: number = Date.now()
): Record<string, unknown> {
  if (!idToken) return {}

  const parts = idToken.split('.')
  if (parts.length !== 3) return {}

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
  } catch {
    return {}
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {}

  const claims = payload as Record<string, unknown>

  // `exp` is seconds since epoch per RFC 7519. A non-numeric or absent value is
  // not treated as expired: some IdPs omit it, and refusing those would demote
  // installations that work today, while the stale-token problem needs a token
  // that is dated and past.
  const exp = claims.exp
  if (typeof exp === 'number' && Number.isFinite(exp) && exp * 1000 <= now) return {}

  return claims
}
