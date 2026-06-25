/**
 * Provider-registry dispatch helpers — pure functions that generalize the
 * auth enforcement logic from the literal `'sso'` provider id to the
 * dynamic identity-provider registry.
 *
 * Kept free of DB/service imports (only `emailDomain` from
 * `normalize-domain`) so `auth-restrictions.ts` can depend on it without a
 * cycle, and so the C2 enforcement rule is unit-testable with inline
 * fixtures.
 */

import { emailDomain } from '@/lib/server/auth/normalize-domain'

/**
 * Is `providerId` a currently-registered OIDC provider?
 *
 * Membership in the loaded `registration_id` set — NOT an `oidc_*` prefix
 * check. The preserved legacy ids `'sso'` / `'custom-oidc'` are ours and
 * carry no prefix, while social ids (`'google'`, …) are never in the set.
 * The set is built by the same enabled+creds+tier gate the auth runtime
 * uses to register genericOAuth providers (see `getRegisteredOidcProviderIds`).
 */
export function isRegisteredOidcProvider(providerId: string, registeredIds: Set<string>): boolean {
  return registeredIds.has(providerId)
}

/**
 * A verified domain as carried on a provider's `domains[]` list. Structural
 * subset of `VerifiedDomain` so inline test fixtures and the real
 * `listIdentityProviders()` shape both satisfy it.
 */
interface DomainLike {
  name: string
  verifiedAt: string | null
  enforced: boolean
}

/**
 * An identity provider with its linked verified domains. Structural subset
 * of `IdentityProvider`; `id` is widened to `string` so the branded
 * `IdentityProviderId` is accepted. Exported so the enforcement predicates
 * in `auth-restrictions.ts` share one shape with this module.
 */
export interface ProviderWithDomains {
  id: string
  registrationId: string
  domains: readonly DomainLike[]
  /** Admin opt-in to also show a public sign-in button for a routed provider.
   *  Drives {@link shouldRenderPublicButton}; required so the enforcement gate
   *  and the button-render decision share one predicate and can't drift. */
  showButton: boolean
}

/** Count of a provider's domains that are actually verified. */
export function verifiedDomainCount(p: {
  domains: readonly { verifiedAt: string | null }[]
}): number {
  return p.domains.filter((d) => d.verifiedAt).length
}

/**
 * Whether the provider is offered as a public sign-in button — button-only
 * providers (no verified domain) always show; a routed provider shows only
 * when the admin opts it back in via `showButton`.
 *
 * THE canonical predicate: shared by the public-button list
 * (`getPublicOidcProviders`), the admin UI, and the portal-eligibility gate
 * (`isSsoBlockedForRole`). Lives here (DB-free) so the gate doesn't pull in the
 * settings service — and so "what renders a button" and "who may sign in via
 * it" can never drift apart.
 */
export function shouldRenderPublicButton(p: {
  domains: readonly { verifiedAt: string | null }[]
  showButton: boolean
}): boolean {
  return verifiedDomainCount(p) === 0 || p.showButton
}

/** The owning provider of the email's matched verified domain. */
export interface DomainOwner {
  id: string
  registrationId: string
  /** The matched domain's `enforced` flag (NOT the provider's). */
  enforced: boolean
}

/**
 * Resolve the provider that OWNS the verified domain matching `email`.
 *
 * Iterates `providers` and returns the first whose `domains[]` contains a
 * VERIFIED (`verifiedAt` truthy) row whose `name` equals the email's
 * normalized domain. The returned `enforced` is that matched domain's flag,
 * so callers can decide "is this email at an *enforced* domain, and who owns
 * it?" in one lookup. Returns `null` when no verified domain matches.
 *
 * Domain normalization is delegated to `emailDomain` (the same helper
 * `findVerifiedDomainForEmail` uses) so case / trailing-dot / IDN handling
 * stays consistent across the codebase.
 */
export function findProviderForDomainEmail(
  email: string | null | undefined,
  providers: readonly ProviderWithDomains[] | undefined
): DomainOwner | null {
  if (!email || !providers?.length) return null
  const candidate = emailDomain(email)
  if (candidate === null) return null

  for (const provider of providers) {
    const match = provider.domains.find((d) => d.verifiedAt !== null && d.name === candidate)
    if (match) {
      return { id: provider.id, registrationId: provider.registrationId, enforced: match.enforced }
    }
  }
  return null
}
