/**
 * Unified OAuth token refresh for integrations (IF WO-13).
 *
 * Providers whose access tokens expire declare a `refreshToken` capability on
 * their IntegrationDefinition (a thin wrapper over their token endpoint); this
 * module owns everything else: the expiry check (5-minute buffer), BY-ID
 * persistence (never by integrationType — an update keyed on type clobbers
 * sibling integrations of the same provider), and invalidation of cached integration mappings.
 */
import type { IntegrationId } from '@quackback/ids'
import { decryptSecrets, encryptSecrets } from './encryption'
import { db, integrations, eq } from '@/lib/server/db'
import { cacheDel, CACHE_KEYS } from '@/lib/server/cache'
import { logger } from '@/lib/server/logger'
import { installationIdentity } from './sync/identity'

const log = logger.child({ component: 'token-refresh' })

const REFRESH_BUFFER_MS = 5 * 60 * 1000

/**
 * Get a valid access token for an integration, refreshing (and persisting)
 * if it is expired or expires within the buffer. Falls back to the stored
 * token when the provider has no refresh capability, no refresh token is
 * stored, or the refresh fails — the API call may still 401, which callers
 * already handle.
 */
export interface IntegrationAuth {
  installation: string | null
  accessToken: string
  config: Record<string, unknown>
  secrets: Record<string, unknown>
}

export async function getValidAccessToken(integrationId: IntegrationId): Promise<string> {
  return (await getIntegrationAuth(integrationId)).accessToken
}

/** Resolve configuration and credentials from the same locked installation snapshot. */
export async function getIntegrationAuth(
  integrationId: IntegrationId,
  rejectedToken?: string
): Promise<IntegrationAuth> {
  let refreshedToken = false
  const token = await db.transaction(async (tx) => {
    // A rotating refresh token is consumed once. Serialize refresh across workers and reconnects.
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId))
      .for('update')
    if (!integration?.secrets)
      return { installation: null, accessToken: '', config: {}, secrets: {} }

    const secrets = decryptSecrets<Record<string, string>>(integration.secrets)
    const config = (integration.config ?? {}) as Record<string, unknown>
    const currentToken = secrets.accessToken || secrets.access_token || ''
    const refreshToken = secrets.refreshToken || secrets.refresh_token
    const tokenExpiresAt = config.tokenExpiresAt as string | undefined

    // Lazy registry import: provider modules import this helper, so a static
    // import of the registry here would create a cycle (provider modules depend on this helper).
    const { getIntegration } = await import('./index')
    const refreshFn = getIntegration(integration.integrationType)?.refreshToken
    const auth = {
      installation: installationIdentity(integration),
      accessToken: currentToken,
      config,
      secrets,
    }
    const rejected = rejectedToken !== undefined && rejectedToken === currentToken
    if (!refreshFn || !refreshToken) return auth
    if (
      !rejected &&
      (!tokenExpiresAt || Date.now() < new Date(tokenExpiresAt).getTime() - REFRESH_BUFFER_MS)
    )
      return auth

    try {
      log.debug({ integration_type: integration.integrationType }, 'refreshing integration token')
      const { getPlatformCredentials } =
        await import('@/lib/server/domains/platform-credentials/platform-credential.service')
      // Reuse the locked transaction's connection, including on one-slot pools.
      const credentials = await getPlatformCredentials(integration.integrationType, tx)
      const refreshed = await refreshFn(refreshToken, credentials ?? undefined, config)
      if (
        !refreshed.accessToken ||
        (refreshed.expiresIn !== undefined &&
          (!Number.isFinite(refreshed.expiresIn) || refreshed.expiresIn <= 0))
      )
        throw new Error('Invalid token refresh response')

      const newExpiry = refreshed.expiresIn
        ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
        : null
      const nextConfig = { ...config, ...refreshed.config, tokenExpiresAt: newExpiry }
      const nextSecrets = {
        ...secrets,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
      }
      await tx
        .update(integrations)
        .set({
          secrets: encryptSecrets(nextSecrets),
          config: nextConfig,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, integrationId))

      refreshedToken = true
      return {
        installation: auth.installation,
        accessToken: refreshed.accessToken,
        config: nextConfig,
        secrets: nextSecrets,
      }
    } catch (err) {
      log.error(
        { err, integration_type: integration.integrationType },
        'integration token refresh failed'
      )
      return auth // Fall back to existing token; the API call may still 401
    }
  })
  if (refreshedToken)
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS).catch((err) =>
      log.error({ err }, 'integration mapping cache invalidation failed')
    )
  return token
}

/** Retry a read once after an explicit authentication rejection. Never wrap a remote write. */
export async function withIntegrationReadAuth<T>(
  integrationId: IntegrationId,
  read: (auth: IntegrationAuth) => Promise<T>
): Promise<T> {
  const auth = await getIntegrationAuth(integrationId)
  try {
    return await read(auth)
  } catch (error) {
    if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 401)
      throw error
    const refreshed = await getIntegrationAuth(integrationId, auth.accessToken)
    if (!refreshed.accessToken || refreshed.accessToken === auth.accessToken) throw error
    return read(refreshed)
  }
}
