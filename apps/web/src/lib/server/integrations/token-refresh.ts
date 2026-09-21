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
import { db, integrations, eq, sql } from '@/lib/server/db'
import { cacheDel, CACHE_KEYS } from '@/lib/server/cache'
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
  let refreshedToken = false
  const token = await db.transaction(async (tx) => {
    // A rotating refresh token is consumed once. Serialize refresh across workers and reconnects.
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId))
      .for('update')
    if (!integration?.secrets) return ''

    const secrets = decryptSecrets<Record<string, string>>(integration.secrets)
    const config = (integration.config ?? {}) as Record<string, unknown>
    const currentToken = secrets.accessToken || secrets.access_token || ''
    const refreshToken = secrets.refreshToken || secrets.refresh_token
    const tokenExpiresAt = config.tokenExpiresAt as string | undefined

    // Lazy registry import: provider modules import this helper, so a static
    // import of the registry here would create a cycle (provider modules depend on this helper).
    const { getIntegration } = await import('./index')
    const refreshFn = getIntegration(integration.integrationType)?.refreshToken
    if (!refreshFn || !refreshToken || !tokenExpiresAt) return currentToken

    const expiresAt = new Date(tokenExpiresAt).getTime()
    if (Date.now() < expiresAt - REFRESH_BUFFER_MS) return currentToken

    try {
      log.debug({ integration_type: integration.integrationType }, 'refreshing integration token')
      const { getPlatformCredentials } =
        await import('@/lib/server/domains/platform-credentials/platform-credential.service')
      const credentials = await getPlatformCredentials(integration.integrationType)
      const refreshed = await refreshFn(refreshToken, credentials ?? undefined)

      const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
      await tx
        .update(integrations)
        .set({
          secrets: encryptSecrets({
            ...secrets,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? refreshToken,
          }),
          config: sql`coalesce(${integrations.config}, '{}'::jsonb) || ${JSON.stringify({ tokenExpiresAt: newExpiry })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, integrationId))

      refreshedToken = true
      return refreshed.accessToken
    } catch (err) {
      log.error(
        { err, integration_type: integration.integrationType },
        'integration token refresh failed'
      )
      return currentToken // Fall back to existing token; the API call may still 401
    }
  })
  if (refreshedToken)
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS).catch((err) =>
      log.error({ err }, 'integration mapping cache invalidation failed')
    )
  return token
}
