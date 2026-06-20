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
import { listIdentityProviders } from '@/lib/server/domains/settings/identity-providers.service'
import { AUTH_CREDENTIAL_PREFIX, getAllAuthProviders } from './auth-providers'

export async function getRegisteredAuthProviders(): Promise<string[]> {
  const ids: string[] = []

  const [tenantSettings, tierLimits, configuredTypes, identityProviders] = await Promise.all([
    getTenantSettings(),
    getTierLimits(),
    getConfiguredIntegrationTypes(),
    listIdentityProviders(),
  ])

  // OIDC providers from the identity_provider list. Mirror
  // buildGenericOAuthConfigs' gate: tier-allowed + row enabled + a
  // credential row present. "Credential present" uses the cached
  // configured-types Set rather than decrypting the secret (this is the
  // hot bootstrap path); a saved credential row always carries the secret.
  if (tierLimits.features.customOidcProvider) {
    for (const provider of identityProviders) {
      if (!provider.enabled) continue
      if (!configuredTypes.has(`${AUTH_CREDENTIAL_PREFIX}${provider.registrationId}`)) continue
      ids.push(provider.registrationId)
    }
  }

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
