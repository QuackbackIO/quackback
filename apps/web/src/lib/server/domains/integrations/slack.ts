/**
 * Slack integration database operations.
 */
import { db, integrations } from '@/lib/server/db'
import { encryptIntegrationToken } from './encryption'
import type { MemberId } from '@quackback/ids'

interface SaveIntegrationParams {
  memberId: MemberId
  accessToken: string
  teamId: string
  teamName: string
}

/**
 * Save or update a Slack integration.
 */
export async function saveIntegration(params: SaveIntegrationParams): Promise<void> {
  const { memberId, accessToken, teamId, teamName } = params
  const encryptedToken = encryptIntegrationToken(accessToken)
  const now = new Date()

  await db
    .insert(integrations)
    .values({
      integrationType: 'slack',
      status: 'active',
      accessTokenEncrypted: encryptedToken,
      externalWorkspaceId: teamId,
      externalWorkspaceName: teamName,
      connectedByMemberId: memberId,
      connectedAt: now,
      config: {},
    })
    .onConflictDoUpdate({
      target: [integrations.integrationType],
      set: {
        status: 'active',
        accessTokenEncrypted: encryptedToken,
        externalWorkspaceId: teamId,
        externalWorkspaceName: teamName,
        connectedByMemberId: memberId,
        connectedAt: now,
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
        updatedAt: now,
      },
    })
}
