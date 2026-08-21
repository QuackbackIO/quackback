import { logger } from '@/lib/server/logger'
import { getCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { parsePlgEventInput, type PlgEventInput } from '@/lib/shared/plg-events'

const log = logger.child({ component: 'plg-events' })

export async function emitPlgEvent(
  input: PlgEventInput,
  identity: { workspaceId: string; principalId: string }
): Promise<void> {
  try {
    const event = parsePlgEventInput(input)
    if (!event || !(await getCloudConfig()).enabled) return
    log.info(
      {
        event: event.name,
        workspace_id: identity.workspaceId,
        principal_id: identity.principalId,
        ...(event.outcome ? { outcome: event.outcome } : {}),
        ...(event.surface ? { surface: event.surface } : {}),
        ...(event.actionId ? { action_id: event.actionId } : {}),
        ...(event.artifactType ? { artifact_type: event.artifactType } : {}),
        timestamp: new Date().toISOString(),
      },
      'plg_event'
    )
  } catch {
    // Analytics is operationally useful, never part of the product transaction.
  }
}
