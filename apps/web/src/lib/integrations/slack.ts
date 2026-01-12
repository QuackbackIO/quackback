/**
 * Slack integration database operations.
 */
import { isMultiTenant } from '@/lib/features'
import type { MemberId } from '@quackback/ids'

interface SaveIntegrationParams {
  workspaceSlug: string
  workspaceId: string
  memberId: MemberId
  accessToken: string
  teamId: string
  teamName: string
}

/**
 * Save or update a Slack integration.
 * Handles multi-tenant and self-hosted modes.
 */
export async function saveIntegration(params: SaveIntegrationParams): Promise<void> {
  const { workspaceSlug, workspaceId, memberId, accessToken, teamId, teamName } = params
  const { db, encryptToken, integrations } = await getDbContext(workspaceSlug)
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

async function getDbContext(workspaceSlug: string) {
  if (isMultiTenant()) {
    const { getTenantDbBySlug } = await import('@/lib/tenant')
    const { encryptToken, integrations } = await import('@quackback/db')
    const { db } = await getTenantDbBySlug(workspaceSlug)
    return { db, encryptToken, integrations }
  }

  const { db, encryptToken, integrations } = await import('@/lib/db')
  return { db, encryptToken, integrations }
}
