/**
 * Platform credential service.
 *
 * Manages OAuth app credentials (client ID, client secret, bot tokens) that
 * enable integrations at the platform level. These are separate from per-instance
 * tokens stored in the integrations table.
 *
 * Reads are delegated to a CredentialSource chosen by config.platformCredentialsSource:
 * - 'db'  (self-host, default): the integration_platform_credentials table + admin UI.
 * - 'env' (managed cloud): shared app creds from INTEGRATION_<PROVIDER>_<FIELD> env
 *   (projected from OpenBao via ESO). In 'env' mode writes are refused — the
 *   credentials are platform-managed, not editable per-tenant.
 */

import { generateId, type PrincipalId } from '@quackback/ids'
import { db, integrationPlatformCredentials, eq } from '@/lib/server/db'
import { cacheGet, cacheSet, cacheDel, CACHE_KEYS } from '@/lib/server/redis'
import { encryptPlatformCredentials } from '@/lib/server/integrations/encryption'
import { config } from '@/lib/server/config'
import { DbCredentialSource, EnvCredentialSource, type CredentialSource } from './credential-source'
import { AUTH_CREDENTIAL_PREFIX } from '@/lib/server/auth/auth-providers'

interface SavePlatformCredentialsInput {
  integrationType: string
  credentials: Record<string, string>
  principalId: PrincipalId
}

/**
 * Thrown when a write is attempted while credentials are platform-managed
 * (config.platformCredentialsSource === 'env'). Callers should surface this as a
 * "managed by the platform" state rather than an error.
 */
export class PlatformCredentialsManagedError extends Error {
  constructor() {
    super('Platform credentials are managed by the platform and cannot be edited here.')
    this.name = 'PlatformCredentialsManagedError'
  }
}

let _dbSource: DbCredentialSource | undefined
let _envSource: EnvCredentialSource | undefined

function dbSource(): DbCredentialSource {
  return (_dbSource ??= new DbCredentialSource())
}

/** The active source for *integration* credentials, per config.platformCredentialsSource. */
function activeSource(): CredentialSource {
  if (config.platformCredentialsSource === 'env') {
    return (_envSource ??= new EnvCredentialSource())
  }
  return dbSource()
}

// Social-login / SSO credentials (auth_*) share this table but are a separate
// concern: they are per-tenant, DB-managed (the control plane seeds auth_sso), and
// the env source has no knowledge of them. They are ALWAYS DB-backed regardless of
// PLATFORM_CREDENTIALS_SOURCE — the env switch governs only the 24 integrations.
function isAuthCredentialType(integrationType: string): boolean {
  return integrationType.startsWith(AUTH_CREDENTIAL_PREFIX)
}

function sourceForType(integrationType: string): CredentialSource {
  return isAuthCredentialType(integrationType) ? dbSource() : activeSource()
}

/**
 * Whether platform credentials for this type are platform-managed (cloud) and not
 * editable here. auth_* credentials are never platform-managed (always DB-editable).
 */
export function arePlatformCredentialsManaged(integrationType?: string): boolean {
  if (integrationType && isAuthCredentialType(integrationType)) return false
  return config.platformCredentialsSource === 'env'
}

/**
 * Save (upsert) platform credentials for an integration type.
 * Encrypts all credential values before storing. Refused in managed-cloud mode.
 */
export async function savePlatformCredentials({
  integrationType,
  credentials,
  principalId,
}: SavePlatformCredentialsInput): Promise<void> {
  if (arePlatformCredentialsManaged(integrationType)) throw new PlatformCredentialsManagedError()

  const encrypted = encryptPlatformCredentials(credentials)
  const now = new Date()

  // Bump auth_config_version atomically with the credential write —
  // platform_credentials is an input to createAuth() (OAuth provider
  // registration consults it), so other pods must see "auth instance
  // is stale" on their next request.
  const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
  const { resetAuth } = await import('@/lib/server/auth')
  await db.transaction(async (tx) => {
    await tx
      .insert(integrationPlatformCredentials)
      .values({
        id: generateId('platform_cred'),
        integrationType,
        secrets: encrypted,
        configuredByPrincipalId: principalId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [integrationPlatformCredentials.integrationType],
        set: {
          secrets: encrypted,
          configuredByPrincipalId: principalId,
          updatedAt: now,
        },
      })
    await bumpAuthConfigVersionInTx(tx)
  })
  resetAuth()
  // One Redis round-trip drops both keys (TENANT_SETTINGS for the
  // version-check fallback, PLATFORM_INTEGRATION_TYPES for the cached
  // configured-types Set hit by getRegisteredAuthProviders).
  await cacheDel(CACHE_KEYS.TENANT_SETTINGS, configuredTypesCacheKey())
}

/**
 * Get decrypted platform credentials for an integration type.
 * Returns null if not configured.
 *
 * Intentionally NOT cached — the returned value contains decrypted OAuth
 * client secrets / bot tokens, and Redis snapshots / replication shouldn't
 * carry plaintext credentials.
 */
export async function getPlatformCredentials(
  integrationType: string
): Promise<Record<string, string> | null> {
  return sourceForType(integrationType).get(integrationType)
}

/**
 * Check if platform credentials exist for an integration type.
 * Lightweight check — no decryption.
 */
export async function hasPlatformCredentials(integrationType: string): Promise<boolean> {
  return sourceForType(integrationType).has(integrationType)
}

/**
 * Get the set of integration types that have platform credentials configured.
 *
 * Cached: hot dependency of getTenantSettings, runs on every settings cache
 * miss. Only the integration-type *names* are cached (no secret material),
 * and save/delete flows invalidate the key.
 */
// In env mode the configured-type set is computed from env (not the DB) and no
// integration write-path invalidates it, so key it separately from db mode —
// otherwise a stale db-mode list (often empty) would be served to env pods after a
// db→env cutover for up to the TTL. db mode keeps the original key (self-host unchanged).
function configuredTypesCacheKey(): string {
  return config.platformCredentialsSource === 'env'
    ? `${CACHE_KEYS.PLATFORM_INTEGRATION_TYPES}:env`
    : CACHE_KEYS.PLATFORM_INTEGRATION_TYPES
}

export async function getConfiguredIntegrationTypes(): Promise<Set<string>> {
  const cached = await cacheGet<string[]>(configuredTypesCacheKey())
  if (cached) return new Set(cached)

  const types = await activeSource().listConfigured()
  // auth_* credentials are always DB-backed (the env source can't enumerate them),
  // so in env mode union them in — otherwise SSO / social-login registration in
  // getRegisteredAuthProviders would report every auth_* provider as unconfigured.
  if (config.platformCredentialsSource === 'env') {
    const dbTypes = await dbSource().listConfigured()
    for (const t of dbTypes) {
      if (isAuthCredentialType(t) && !types.includes(t)) types.push(t)
    }
  }
  await cacheSet(configuredTypesCacheKey(), types, 3600)
  return new Set(types)
}

/**
 * Delete platform credentials for an integration type. Refused in managed-cloud mode.
 */
export async function deletePlatformCredentials(integrationType: string): Promise<void> {
  if (arePlatformCredentialsManaged(integrationType)) throw new PlatformCredentialsManagedError()

  const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
  const { resetAuth } = await import('@/lib/server/auth')
  await db.transaction(async (tx) => {
    await tx
      .delete(integrationPlatformCredentials)
      .where(eq(integrationPlatformCredentials.integrationType, integrationType))
    await bumpAuthConfigVersionInTx(tx)
  })
  resetAuth()
  await cacheDel(CACHE_KEYS.TENANT_SETTINGS, configuredTypesCacheKey())
}
