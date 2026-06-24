import { AUTH_PROVIDERS } from '@/lib/shared/auth-providers'
import { isSignInMethodEnabled } from '@/lib/shared/signin-methods'

/** Social provider ids (built-in Better-Auth socials). OIDC providers are
 *  `generic-oauth` and counted via `identityProviders`, never as an `oauth`
 *  key — keeping the `oauth` config and the identity_provider table disjoint
 *  (a legacy `custom-oidc` toggle would otherwise double-count its IdP row). */
const SOCIAL_PROVIDER_IDS = new Set(
  AUTH_PROVIDERS.filter((p) => p.type !== 'generic-oauth').map((p) => p.id)
)

/**
 * Count the sign-in methods that would actually accept a sign-in right now,
 * across every surface (built-in email, social OAuth, and OIDC identity
 * providers). This is the single source of truth behind the "keep at least one
 * method enabled" guard, so disabling the last *working* method is blocked no
 * matter which surface it lives on.
 *
 *  - password   — counts whenever enabled.
 *  - magicLink  — only when email delivery is configured (otherwise the toggle
 *                 is on but the runtime path rejects).
 *  - social     — only when it's a known social provider AND its credentials
 *                 are saved (`credentialStatus`).
 *  - identity providers — only when enabled AND configured (a client secret is
 *                 saved); an enabled-but-secretless IdP registers nothing, so it
 *                 is not a usable fallback.
 *
 * Non-social `oauth` keys (legacy `email`, or an `oidc`/`custom-oidc` flag) are
 * ignored here — they aren't social methods.
 */
export interface AuthMethodInputs {
  /** Unified per-provider toggle state (password / magicLink / social ids). */
  oauthState: Record<string, boolean | undefined>
  /** Whether SMTP/Resend delivery is wired — gates magic link usability. */
  emailConfigured: boolean
  /** Saved-credential presence per social provider id. */
  credentialStatus: Record<string, boolean>
  /** Identity providers and whether each is enabled + has a saved secret. */
  identityProviders: ReadonlyArray<{ enabled: boolean; configured: boolean }>
}

export function countEnabledAuthMethods({
  oauthState,
  emailConfigured,
  credentialStatus,
  identityProviders,
}: AuthMethodInputs): number {
  // Password is on unless explicitly false (absent ⇒ on), so seed it from the
  // canonical predicate rather than the explicit-entry loop below — upgraded /
  // default configs often omit the `password` key entirely, and missing it here
  // would make the UI report zero (or one-too-few) working methods.
  const builtinAndSocial = Object.entries(oauthState).reduce(
    (acc, [id, enabled]) => {
      if (id === 'password') return acc // counted via the seed above
      if (!enabled) return acc
      if (id === 'magicLink') return emailConfigured ? acc + 1 : acc
      // Social only — OIDC providers are counted via `identityProviders`.
      return SOCIAL_PROVIDER_IDS.has(id) && credentialStatus[id] ? acc + 1 : acc
    },
    isSignInMethodEnabled(oauthState, 'password') ? 1 : 0
  )
  const idps = identityProviders.filter((p) => p.enabled && p.configured).length
  return builtinAndSocial + idps
}
