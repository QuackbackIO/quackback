/**
 * Jira access-token refresh. Plain server module (not a serverFn file) so the
 * events worker can call it without tripping TanStack Start import protection.
 */

import type { IntegrationId } from '@quackback/ids'

export interface JiraTokenConfig {
  cloudId?: string
  siteUrl?: string
  workspaceName?: string
  tokenExpiresAt?: string
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000

function isExpiredOrExpiring(tokenExpiresAt: string | undefined): boolean {
  if (!tokenExpiresAt) return false
  return Date.now() >= new Date(tokenExpiresAt).getTime() - REFRESH_BUFFER_MS
}

/**
 * Refresh the Jira token if expired or about to expire (within 5 minutes).
 * Returns the current access token.
 *
 * Mappings are cached for 5 minutes, and Atlassian rotates refresh tokens.
 * A refresh takes a row lock so two events cannot rotate the same token.
 * Persist by integration id (never by type).
 */
export async function getJiraAccessToken(integration: {
  id?: string
  secrets: unknown
  config: unknown
}): Promise<string> {
  const { decryptSecrets } = await import('../encryption')

  const cachedSecrets = decryptSecrets<{ accessToken: string; refreshToken?: string }>(
    integration.secrets as string
  )
  const cachedCfg = (integration.config ?? {}) as JiraTokenConfig

  if (!cachedSecrets.refreshToken || !isExpiredOrExpiring(cachedCfg.tokenExpiresAt)) {
    return cachedSecrets.accessToken
  }

  // No row id (stale cache shape): do not refresh — we cannot persist safely.
  const integrationId = integration.id
  if (!integrationId) {
    return cachedSecrets.accessToken
  }

  const { db, integrations, eq } = await import('@/lib/server/db')
  const rowId = integrationId as IntegrationId

  let didRefresh = false
  const token = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ secrets: integrations.secrets, config: integrations.config })
      .from(integrations)
      .where(eq(integrations.id, rowId))
      .for('update')

    let secrets = cachedSecrets
    let cfg = cachedCfg
    if (row?.secrets) {
      secrets = decryptSecrets<{ accessToken: string; refreshToken?: string }>(
        row.secrets as string
      )
      cfg = (row.config ?? {}) as JiraTokenConfig
      if (!secrets.refreshToken || !isExpiredOrExpiring(cfg.tokenExpiresAt)) {
        return secrets.accessToken
      }
    }

    const refreshToken = secrets.refreshToken
    if (!refreshToken) {
      return secrets.accessToken
    }

    const { logger } = await import('@/lib/server/logger')
    const log = logger.child({ component: 'jira' })
    log.info({ integration_id: rowId }, 'access token expired, refreshing')

    const { refreshJiraToken } = await import('./oauth')
    const { getPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    const { encryptSecrets } = await import('../encryption')
    const credentials = await getPlatformCredentials('jira')
    const refreshed = await refreshJiraToken(refreshToken, credentials ?? undefined)

    const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
    await tx
      .update(integrations)
      .set({
        secrets: encryptSecrets({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
        }),
        config: { ...cfg, tokenExpiresAt: newExpiry },
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, rowId))

    didRefresh = true
    return refreshed.accessToken
  })

  // After commit: Atlassian has already rotated the refresh token. A Redis
  // failure must not roll back the persisted tokens.
  if (didRefresh) {
    const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
    await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS).catch(() => undefined)
  }

  return token
}
