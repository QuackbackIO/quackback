/**
 * Slack integration database operations.
 */
import { db, encryptToken, integrations } from '@/lib/server/db'
import type { MemberId } from '@quackback/ids'

interface SaveIntegrationParams {
  workspaceId: string
  memberId: MemberId
  accessToken: string
  teamId: string
  teamName: string
}

/**
 * Save or update a Slack integration.
 */
export async function saveIntegration(params: SaveIntegrationParams): Promise<void> {
  const { workspaceId, memberId, accessToken, teamId, teamName } = params
  const encryptedToken = encryptToken(accessToken, workspaceId)
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
