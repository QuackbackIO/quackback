/**
 * remote_status_push hook (IF WO-15). Executes one outbound status push: writes
 * the mapped remote status to a linked external item via the provider's
 * `remoteStatus.push` capability. The resolver already decided WHAT to push and
 * enforced loop-safety; this handler only performs the remote write, refreshing
 * the token by id (WO-13) at run time.
 */
import type { HookHandler, HookResult } from '../hook-types'
import type { IntegrationId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'remote-status-push-hook' })

interface PushTarget {
  integrationType: string
  externalId: string
  entityType: string
}

export const remoteStatusPushHook: HookHandler = {
  async run(_event, target, config): Promise<HookResult> {
    const { integrationType, externalId } = target as PushTarget
    const integrationId = config.integrationId as string | undefined
    const remoteStatus = config.remoteStatus as string | undefined

    if (!integrationId || !remoteStatus) {
      return { success: false, error: 'missing integrationId or remoteStatus' }
    }

    const { getIntegration } = await import('@/lib/server/integrations')
    const push = getIntegration(integrationType)?.remoteStatus?.push
    if (!push) {
      // Capability removed since the resolver ran — nothing to do, don't retry.
      return { success: true }
    }

    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const accessToken = await getValidAccessToken(integrationId as IntegrationId)
    if (!accessToken) return { success: false, error: 'no access token' }

    const { db, integrations, eq } = await import('@/lib/server/db')
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId as IntegrationId),
    })
    const integrationConfig = (integration?.config ?? {}) as Record<string, unknown>

    try {
      const result = await push({
        accessToken,
        config: integrationConfig,
        externalId,
        remoteStatus,
      })
      if (!result.success) {
        log.warn(
          { integration_type: integrationType, external_id: externalId, err: result.error },
          'remote status push failed'
        )
        return { success: false, error: result.error, shouldRetry: true }
      }
      return { success: true, externalId }
    } catch (error) {
      log.error(
        { err: error, integration_type: integrationType, external_id: externalId },
        'remote status push threw'
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        shouldRetry: true,
      }
    }
  },
}
