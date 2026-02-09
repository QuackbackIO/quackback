/**
 * Shared integration save logic.
 * Replaces the per-integration save.ts files with a single function.
 */
import { db, integrations } from '@/lib/server/db'
import { encryptSecrets } from './encryption'
import type { PrincipalId } from '@quackback/ids'

export interface SaveIntegrationParams {
  principalId: PrincipalId
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  config?: Record<string, unknown>
}

/**
 * Save or update an integration connection.
 * Encrypts secrets, computes token expiry, and upserts the integration row.
 */
export async function saveIntegration(
  integrationType: string,
  params: SaveIntegrationParams
): Promise<void> {
  const { principalId, accessToken, refreshToken, expiresIn, config: oauthConfig } = params

  const secrets: Record<string, unknown> = { accessToken }
  if (refreshToken) secrets.refreshToken = refreshToken

  const encryptedSecrets = encryptSecrets(secrets)
  const now = new Date()
  const tokenExpiresAt = expiresIn ? new Date(now.getTime() + expiresIn * 1000) : undefined

  const config = {
    ...oauthConfig,
    ...(tokenExpiresAt ? { tokenExpiresAt: tokenExpiresAt.toISOString() } : {}),
  }

  await db
    .insert(integrations)
    .values({
      integrationType,
      status: 'active',
      secrets: encryptedSecrets,
      connectedByPrincipalId: principalId,
      connectedAt: now,
      config,
    })
    .onConflictDoUpdate({
      target: [integrations.integrationType],
      set: {
        status: 'active',
        secrets: encryptedSecrets,
        connectedByPrincipalId: principalId,
        connectedAt: now,
        config,
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
        updatedAt: now,
      },
    })
}
