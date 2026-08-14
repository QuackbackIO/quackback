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

/**
 * Refresh the Jira token if expired or about to expire (within 5 minutes).
 * Returns the current access token.
 */
export async function getJiraAccessToken(integration: {
  secrets: unknown
  config: unknown
}): Promise<string> {
  const { decryptSecrets, encryptSecrets } = await import('../encryption')
  const { db, integrations, eq } = await import('@/lib/server/db')
  const { logger } = await import('@/lib/server/logger')
  const log = logger.child({ component: 'jira' })

  const secrets = decryptSecrets<{ accessToken: string; refreshToken?: string }>(
    integration.secrets as string
  )
  const cfg = (integration.config ?? {}) as JiraTokenConfig

  if (secrets.refreshToken && cfg.tokenExpiresAt) {
    const expiresAt = new Date(cfg.tokenExpiresAt).getTime()
    const bufferMs = 5 * 60 * 1000
    if (Date.now() >= expiresAt - bufferMs) {
      log.info('access token expired, refreshing')
      const { refreshJiraToken } = await import('./oauth')
      const { getPlatformCredentials } =
        await import('@/lib/server/domains/platform-credentials/platform-credential.service')
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
        .where(eq(integrations.integrationType, 'jira'))

      return refreshed.accessToken
    }
  }

  return secrets.accessToken
}
