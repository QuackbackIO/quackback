/**
 * Registered-providers introspection — used by BootstrapData to drive
 * admin login UI decisions (e.g. "show SSO as the default CTA only if
 * it's actually wired up at the auth layer").
 *
 * Mirrors `createAuth()` in `index.ts`. A provider is reported iff:
 *   - SSO: `settings.authConfig.ssoOidc.enabled` AND `auth_sso` row in
 *     platform_credentials AND the `customOidcProvider` tier flag.
 *   - OAuth (Google/GitHub/etc.): credentials in platform_credentials
 *     AND at least one surface (team or portal) has it enabled (the
 *     Layer A registration filter), AND — for generic-oauth providers —
 *     the `customOidcProvider` tier flag is on.
 *
 * The "at least one surface" filter must mirror auth/index.ts exactly,
 * otherwise BootstrapData would report a provider as registered that
 * the runtime declined to register, and the admin login UI would render
 * a button that 404s on click.
 */

import { getTenantSettings } from '@/lib/server/domains/settings/settings.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { getConfiguredIntegrationTypes } from '@/lib/server/domains/platform-credentials/platform-credential.service'
import { isSsoActuallyRegistered } from './sso-secret'
import { getAllAuthProviders } from './auth-providers'

export async function getRegisteredAuthProviders(): Promise<string[]> {
  const ids: string[] = []

  const [tenantSettings, tierLimits, configuredTypes] = await Promise.all([
    getTenantSettings(),
    getTierLimits(),
    getConfiguredIntegrationTypes(),
  ])
  // Shared predicate with `auth/index.ts createAuth()` — keeps this
  // mirror's registration condition lockstep with what the runtime
  // actually registers. The Set lookup inside is cache-hot.
  if (await isSsoActuallyRegistered(tenantSettings?.authConfig?.ssoOidc, tierLimits)) {
    ids.push('sso')
  }

  // Layer A registration filter: a provider is registered globally on
  // the Better-Auth instance only when at least one surface enables it.
  // Default-false on both: if neither surface opted in, the runtime
  // skips registration even if creds exist, and we mirror that here.
  const teamOAuth = (tenantSettings?.authConfig?.oauth ?? {}) as Record<string, boolean | undefined>
  const portalOAuth = (tenantSettings?.portalConfig?.oauth ?? {}) as Record<
    string,
    boolean | undefined
  >

  for (const provider of getAllAuthProviders()) {
    if (!configuredTypes.has(provider.credentialType)) continue
    if (provider.type === 'generic-oauth' && !tierLimits.features.customOidcProvider) continue
    if (teamOAuth[provider.id] !== true && portalOAuth[provider.id] !== true) continue
    ids.push(provider.id)
  }

  return ids
}
