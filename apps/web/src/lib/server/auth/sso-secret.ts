/**
 * SSO OIDC client-secret read helper.
 *
 * Customer-owned secret (issued by the admin's IdP — Azure Entra app
 * registration, Okta app, Auth0 application, Keycloak client). Stored
 * encrypted in `platform_credentials` with `integrationType='auth_sso'`,
 * matching how Google/GitHub OAuth client secrets are stored.
 *
 * Cross-pod invalidation, encryption, and the save/delete lifecycle
 * are handled by `savePlatformCredentials` already.
 */

import {
  getConfiguredIntegrationTypes,
  getPlatformCredentials,
} from '@/lib/server/domains/platform-credentials/platform-credential.service'
import type { AuthConfig } from '@/lib/server/domains/settings/settings.types'
import type { TierLimits } from '@/lib/server/domains/settings/tier-limits.types'

export const SSO_CREDENTIAL_TYPE = 'auth_sso' as const

/** Returns the SSO OIDC client secret from `platform_credentials`,
 *  or null when no row exists. Decrypts on every call — callers
 *  should be on the auth runtime path, not the hot UI status path. */
export async function getSsoClientSecret(): Promise<string | null> {
  const row = await getPlatformCredentials(SSO_CREDENTIAL_TYPE)
  return row?.clientSecret ?? null
}

/** "Is the SSO secret available?" — used by the status row and the
 *  enforcement bootstrap precondition. Reads the cached configured-
 *  integration-types Set (1h TTL, invalidated on save/delete) so
 *  status-page renders don't decrypt the secret unnecessarily. */
export async function hasSsoClientSecret(): Promise<boolean> {
  const types = await getConfiguredIntegrationTypes()
  return types.has(SSO_CREDENTIAL_TYPE)
}

/**
 * Predicate matching the conditions under which `auth/index.ts`
 * registers the SSO generic-OAuth provider. The login dispatcher and
 * the runtime registration filter both consult this so verified-
 * domain users are never redirected to a provider the auth instance
 * didn't register (tier downgrade, secret never saved, or any future
 * registration precondition added here).
 */
export async function isSsoActuallyRegistered(
  sso: AuthConfig['ssoOidc'],
  tierLimits: Pick<TierLimits, 'features'>
): Promise<boolean> {
  if (!sso?.enabled) return false
  if (!tierLimits.features.customOidcProvider) return false
  return hasSsoClientSecret()
}
