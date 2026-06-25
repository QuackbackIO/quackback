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

import { getConfiguredIntegrationTypes } from '@/lib/server/domains/platform-credentials/platform-credential.service'

export const SSO_CREDENTIAL_TYPE = 'auth_sso' as const

/** "Is the SSO secret available?" — backs the secret-presence gate that
 *  blocks enabling SSO without a saved client secret. Reads the cached
 *  configured-integration-types Set (1h TTL, invalidated on save/delete)
 *  so callers don't decrypt the secret unnecessarily. */
export async function hasSsoClientSecret(): Promise<boolean> {
  const types = await getConfiguredIntegrationTypes()
  return types.has(SSO_CREDENTIAL_TYPE)
}
