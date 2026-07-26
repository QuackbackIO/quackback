/**
 * Claim normalisation applied to every OAuth/OIDC profile via the
 * genericOAuth + social `mapProfileToUser` hook.
 *
 * The hook's return value is spread OVER the resolved user info by
 * Better-Auth, so whatever this returns wins for the keys it sets. That is
 * what lets us tighten `email_verified` without patching the library.
 *
 * Kept pure and standalone (no DB, no config) so the rules are unit-testable
 * and so `createAuth()` holds no inline claim logic.
 */

/**
 * OIDC Core types `email_verified` as a boolean, but SAML-to-OIDC bridges
 * routinely stringify it — and the string `"false"` is truthy, which is how an
 * unverified address ended up marking the local account verified. That value
 * then renders a verified badge in admin, ships as a boolean on the public API,
 * and satisfies the local-verification guard that gates trusted-provider
 * linking.
 *
 * Affirmative means literal `true` or the exact (case-insensitive) string
 * `"true"`. Everything else is false. Accepting `"true"` avoids demoting the
 * bridges that already work; refusing `1`, `"yes"` and friends keeps this from
 * turning back into truthiness by degrees.
 */
function claimIsAffirmative(value: unknown): boolean {
  if (value === true) return true
  return typeof value === 'string' && value.toLowerCase() === 'true'
}

/**
 * Declared as a type alias rather than an interface deliberately: Better-Auth
 * types the hook's return as `Record<string, unknown>`, and TypeScript grants
 * an implicit index signature to type aliases but not to interfaces.
 */
export type MappedProfileClaims = {
  /** BCP-47 locale claim, or null when absent/blank/non-string. */
  locale: string | null
  /** Strictly coerced `email_verified`. */
  emailVerified: boolean
}

export function mapProfileClaims(profile: unknown): MappedProfileClaims {
  const p = profile as { locale?: unknown; email_verified?: unknown } | null | undefined
  return {
    locale: typeof p?.locale === 'string' && p.locale.length > 0 ? p.locale : null,
    emailVerified: claimIsAffirmative(p?.email_verified),
  }
}
