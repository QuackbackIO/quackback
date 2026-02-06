/**
 * Slack integration database operations.
 */
import { db, integrations } from '@/lib/server/db'
import { encryptSecrets } from '../encryption'
import type { MemberId } from '@quackback/ids'

interface SaveIntegrationParams {
  memberId: MemberId
  accessToken: string
  externalWorkspaceId: string
  externalWorkspaceName: string
  refreshToken?: string
  expiresIn?: number
}

/**
 * Save or update a Slack integration.
 */
export async function saveIntegration(params: SaveIntegrationParams): Promise<void> {
  const {
    memberId,
    accessToken,
    externalWorkspaceId,
    externalWorkspaceName,
    refreshToken,
    expiresIn,
  } = params

  const secrets: Record<string, unknown> = { accessToken }
  if (refreshToken) secrets.refreshToken = refreshToken
  if (expiresIn) secrets.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  const encryptedSecrets = encryptSecrets(secrets)
  const now = new Date()

  await db
    .insert(integrations)
    .values({
      integrationType: 'slack',
      status: 'active',
      secrets: encryptedSecrets,
      externalWorkspaceId,
      externalWorkspaceName,
      connectedByMemberId: memberId,
      connectedAt: now,
      config: {},
    })
    .onConflictDoUpdate({
      target: [integrations.integrationType],
      set: {
        status: 'active',
        secrets: encryptedSecrets,
        externalWorkspaceId,
        externalWorkspaceName,
        connectedByMemberId: memberId,
        connectedAt: now,
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
        updatedAt: now,
      },
    })
}
