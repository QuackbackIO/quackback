/**
 * Registered-providers introspection — used by BootstrapData to drive
 * admin/portal login UI decisions (e.g. "show SSO as the default CTA only
 * if it's actually wired up at the auth layer").
 *
 * Mirrors `createAuth()` in `index.ts`. A provider is reported iff:
 *   - OIDC (identity_provider rows, incl. migrated 'sso'/'custom-oidc'):
 *     the row is `enabled`, a credential row exists, AND the
 *     `customOidcProvider` tier flag is on. This mirrors
 *     `buildGenericOAuthConfigs`' gate (enabled + secret present + tier),
 *     using the cached configured-types Set so this UI path never decrypts.
 *   - OAuth (Google/GitHub/etc.): credentials in platform_credentials AND
 *     at least one surface (team or portal) has it enabled (the Layer A
 *     registration filter). Generic-oauth entries in AUTH_PROVIDERS are
 *     skipped here — they're now owned by the identity_provider loop above.
 *
 * The gates must mirror auth/index.ts exactly, otherwise BootstrapData would
 * report a provider as registered that the runtime declined to register, and
 * the login UI would render a button that 404s on click.
 */

import { getTenantSettings } from '@/lib/server/domains/settings/settings.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { getConfiguredIntegrationTypes } from '@/lib/server/domains/platform-credentials/platform-credential.service'
import {
  listIdentityProviders,
  type IdentityProvider,
} from '@/lib/server/domains/settings/identity-providers.service'
import { AUTH_CREDENTIAL_PREFIX, getAllAuthProviders } from './auth-providers'

/**
 * The set of OIDC provider `registrationId`s the auth runtime registers
 * right now. Mirrors `buildGenericOAuthConfigs`' gate exactly: the
 * `customOidcProvider` tier flag is on, the provider row is `enabled`, and a
 * credential row exists. "Credential present" uses the cached
 * configured-types Set rather than decrypting the secret — a saved
 * credential row always carries the secret.
 *
 * This is THE shared definition of "registered OIDC provider" consulted by
 * the enforcement / dispatch code (`isHardBound`, `isAuthMethodAllowed`,
 * `isRegisteredOidcProvider`) and by the UI mirror below. Keeping a single
 * source avoids the bootstrap UI reporting a provider the runtime declined.
 *
 * @param providers - Optional pre-fetched provider list to avoid a redundant
 *   `listIdentityProviders()` round-trip when the caller already has it.
 */
export async function getRegisteredOidcProviderIds(
  providers?: IdentityProvider[]
): Promise<Set<string>> {
  const [tierLimits, configuredTypes, identityProviders] = await Promise.all([
    getTierLimits(),
    getConfiguredIntegrationTypes(),
    providers ? Promise.resolve(providers) : listIdentityProviders(),
  ])

  const ids = new Set<string>()
  if (!tierLimits.features.customOidcProvider) return ids
  for (const provider of identityProviders) {
    if (!provider.enabled) continue
    if (!configuredTypes.has(`${AUTH_CREDENTIAL_PREFIX}${provider.registrationId}`)) continue
    ids.add(provider.registrationId)
  }
  return ids
}

export async function getRegisteredAuthProviders(): Promise<string[]> {
  const [tenantSettings, configuredTypes, identityProviders] = await Promise.all([
    getTenantSettings(),
    getConfiguredIntegrationTypes(),
    listIdentityProviders(),
  ])

  // OIDC providers from the identity_provider list — the same gate the auth
  // runtime applies (tier + enabled + credential present), via the shared
  // helper so the UI mirror never diverges from registration.
  const ids: string[] = [...(await getRegisteredOidcProviderIds(identityProviders))]

  // Layer A registration filter: a social provider is registered globally
  // on the Better-Auth instance only when at least one surface enables it.
  // Default-false on both: if neither surface opted in, the runtime skips
  // registration even if creds exist, and we mirror that here.
  const teamOAuth = (tenantSettings?.authConfig?.oauth ?? {}) as Record<string, boolean | undefined>
  const portalOAuth = (tenantSettings?.portalConfig?.oauth ?? {}) as Record<
    string,
    boolean | undefined
  >

  for (const provider of getAllAuthProviders()) {
    // OIDC providers are reported via the identity_provider loop above;
    // skip them here so custom-oidc isn't double-reported (and isn't
    // gated on the now-unused surface oauth flag).
    if (provider.type === 'generic-oauth') continue
    if (!configuredTypes.has(provider.credentialType)) continue
    if (teamOAuth[provider.id] !== true && portalOAuth[provider.id] !== true) continue
    ids.push(provider.id)
  }

  return ids
}
