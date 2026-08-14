/**
 * Jira access-token refresh. Plain server module (not a serverFn file) so the
 * events worker can call it without tripping TanStack Start import protection.
 */

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
 * When a refresh is needed we re-read the row so a prior event's rotation
 * is not replayed, then persist by integration id (never by type).
 */
export async function getJiraAccessToken(integration: {
  id?: string
  secrets: unknown
  config: unknown
}): Promise<string> {
  const { decryptSecrets } = await import('../encryption')

  let secrets = decryptSecrets<{ accessToken: string; refreshToken?: string }>(
    integration.secrets as string
  )
  let cfg = (integration.config ?? {}) as JiraTokenConfig

  if (!secrets.refreshToken || !isExpiredOrExpiring(cfg.tokenExpiresAt)) {
    return secrets.accessToken
  }

  // No row id (stale cache shape): do not refresh — we cannot persist safely.
  if (!integration.id) {
    return secrets.accessToken
  }

  const { db, integrations, eq } = await import('@/lib/server/db')
  const row = await db.query.integrations.findFirst({
    where: eq(integrations.id, integration.id),
    columns: { secrets: true, config: true },
  })
  if (row?.secrets) {
    secrets = decryptSecrets<{ accessToken: string; refreshToken?: string }>(row.secrets as string)
    cfg = (row.config ?? {}) as JiraTokenConfig
    if (!secrets.refreshToken || !isExpiredOrExpiring(cfg.tokenExpiresAt)) {
      return secrets.accessToken
    }
  }

  const { logger } = await import('@/lib/server/logger')
  const log = logger.child({ component: 'jira' })
  log.info({ integration_id: integration.id }, 'access token expired, refreshing')

  const { refreshJiraToken } = await import('./oauth')
  const { getPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const { encryptSecrets } = await import('../encryption')
  const credentials = await getPlatformCredentials('jira')
  const refreshed = await refreshJiraToken(secrets.refreshToken, credentials ?? undefined)

  const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
  await db
    .update(integrations)
    .set({
      secrets: encryptSecrets({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      }),
      config: { ...cfg, tokenExpiresAt: newExpiry },
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, integration.id))

  const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
  await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)

  return refreshed.accessToken
}
