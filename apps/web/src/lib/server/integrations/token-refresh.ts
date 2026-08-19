/**
 * Unified OAuth token refresh for integrations (IF WO-13).
 *
 * Providers whose access tokens expire declare a `refreshToken` capability on
 * their IntegrationDefinition (a thin wrapper over their token endpoint); this
 * module owns everything else: the expiry check (5-minute buffer), BY-ID
 * persistence (never by integrationType — an update keyed on type clobbers
 * sibling integrations of the same provider), and invalidation of the event
 * resolver's cached mapping blob, which holds encrypted secrets for up to
 * 300s and would otherwise keep delivering with the stale token.
 */
import type { IntegrationId } from '@quackback/ids'
import { decryptSecrets, encryptSecrets } from './encryption'
import { db, integrations, eq } from '@/lib/server/db'
import { cacheDel, CACHE_KEYS } from '@/lib/server/redis'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'token-refresh' })

const REFRESH_BUFFER_MS = 5 * 60 * 1000

/**
 * Get a valid access token for an integration, refreshing (and persisting)
 * if it is expired or expires within the buffer. Falls back to the stored
 * token when the provider has no refresh capability, no refresh token is
 * stored, or the refresh fails — the API call may still 401, which callers
 * already handle.
 */
export async function getValidAccessToken(integrationId: IntegrationId): Promise<string> {
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, integrationId),
  })
  if (!integration?.secrets) return ''

  const secrets = decryptSecrets<Record<string, string>>(integration.secrets)
  const config = (integration.config ?? {}) as Record<string, unknown>
  const token = secrets.accessToken || secrets.access_token || ''
  const refreshToken = secrets.refreshToken || secrets.refresh_token
  const tokenExpiresAt = config.tokenExpiresAt as string | undefined

  // Lazy registry import: provider modules import this helper, so a static
  // import of the registry here would create a cycle (same as archive.ts).
  const { getIntegration } = await import('./index')
  const refreshFn = getIntegration(integration.integrationType)?.refreshToken
  if (!refreshFn || !refreshToken || !tokenExpiresAt) return token

  const expiresAt = new Date(tokenExpiresAt).getTime()
  if (Date.now() < expiresAt - REFRESH_BUFFER_MS) return token

  try {
    log.debug({ integration_type: integration.integrationType }, 'refreshing integration token')
    const { getPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    const credentials = await getPlatformCredentials(integration.integrationType)
    const refreshed = await refreshFn(refreshToken, credentials ?? undefined)

    const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
    await db
      .update(integrations)
      .set({
        secrets: encryptSecrets({
          ...secrets,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? refreshToken,
        }),
        config: { ...config, tokenExpiresAt: newExpiry },
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId))

    // The integration resolver caches the encrypted secrets blob for 300s;
    // a refreshed token must not wait out the TTL.
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)

    return refreshed.accessToken
  } catch (err) {
    log.error(
      { err, integration_type: integration.integrationType },
      'integration token refresh failed'
    )
    return token // Fall back to existing token; the API call may still 401
  }
}
