/**
 * Pure per-provider login routing for the email-first dispatcher.
 *
 * Given an email and the workspace's identity providers (each with its
 * linked verified domains and a liveness snapshot), decides whether the
 * client should redirect to an IdP or render the methods form. Kept free
 * of DB/service imports (only `emailDomain`) so it is unit-testable with
 * inline fixtures and so `lookupAuthMethodsFn` is the only place that
 * wires it to the real provider registry.
 *
 * The owning provider of the email's verified domain drives the decision:
 *   - enforced domain → `sso-redirect` (hard-bound; no methods escape)
 *   - verified-but-not-enforced domain → `sso-default` (SSO is the default
 *     CTA, but the methods form remains a fallback)
 *   - no owning provider → `methods`
 *
 * **Liveness gate.** A provider only routes when it is actually viable
 * right now (`enabled && registered && credsPresent` — the same gate the
 * auth runtime applies via `getRegisteredOidcProviderIds` /
 * `buildGenericOAuthConfigs`). If the owner is disabled, off-tier, or
 * missing its secret, routing falls through to `methods` rather than
 * dead-redirecting to a provider whose `/oauth2/callback` 404s. This
 * preserves the pre-registry `isSsoConfigured` master-switch behavior and
 * stays consistent with `isHardBound`, which fails open (scoped to the
 * owner) when the owning IdP isn't registered.
 */

import { emailDomain } from '@/lib/server/auth/normalize-domain'

/** A verified domain as carried on a provider's `domains[]`. */
interface RoutableDomain {
  name: string
  verifiedAt: string | null
  enforced: boolean
}

/**
 * An identity provider with the liveness snapshot routing needs.
 * `registered` is membership in the registered-OIDC set (already implies
 * enabled + creds + tier); `enabled`/`credsPresent` are carried so the
 * gate is explicit and independently testable.
 */
export interface RoutableProvider {
  registrationId: string
  enabled: boolean
  registered: boolean
  credsPresent: boolean
  domains: readonly RoutableDomain[]
}

export type LoginRouting =
  | { kind: 'sso-redirect'; providerId: string }
  | { kind: 'sso-default'; providerId: string }
  | { kind: 'methods' }

/**
 * Resolve the login routing for `email` against the workspace's providers.
 * See the module docstring for the decision table and the liveness gate.
 */
export function resolveLoginRouting(
  email: string | null | undefined,
  providers: readonly RoutableProvider[]
): LoginRouting {
  const candidate = emailDomain(email ?? '')
  if (candidate === null) return { kind: 'methods' }

  for (const provider of providers) {
    // A domain links to exactly one provider, so the first verified match
    // is the owner; we never look past it for a "more alive" owner.
    const match = provider.domains.find((d) => d.verifiedAt !== null && d.name === candidate)
    if (!match) continue

    // Liveness gate — an enforced domain owned by a dead IdP must fall
    // through to methods, not dead-redirect.
    if (!(provider.enabled && provider.registered && provider.credsPresent)) {
      return { kind: 'methods' }
    }

    return match.enforced
      ? { kind: 'sso-redirect', providerId: provider.registrationId }
      : { kind: 'sso-default', providerId: provider.registrationId }
  }

  return { kind: 'methods' }
}
