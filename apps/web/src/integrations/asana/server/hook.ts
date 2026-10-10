import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Asana hook handler.
 * Creates Asana tasks when feedback events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildAsanaTaskBody } from '@/integrations/asana/server/message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'asana' })

const ASANA_API = 'https://app.asana.com/api/1.0'

export interface AsanaTarget {
  channelId: string // projectId is stored as channelId for consistency
}

export interface AsanaConfig {
  accessToken: string
  rootUrl: string
  workspaceGid: string
}

export const asanaHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: projectId } = target as AsanaTarget
    const { accessToken, rootUrl, workspaceGid } = config as AsanaConfig

    // Only create tasks for new feedback
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    log.debug({ event_type: event.type, project_id: projectId }, 'creating task')

    const { name, htmlNotes } = buildAsanaTaskBody(event, rootUrl)

    try {
      const response = await integrationFetch(`${ASANA_API}/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            name,
            html_notes: htmlNotes,
            projects: [projectId],
            workspace: workspaceGid,
          },
        }),
      })

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const body = (await response.json()) as {
        data?: { gid: string; permalink_url: string }
      }

      const task = body.data
      if (!task) {
        return { state: 'uncertain', errorCode: 'outcome_unknown' }
      }

      log.info({ task_id: task.gid }, 'task created')
      return {
        state: 'succeeded',
        result: { externalId: task.gid, externalUrl: task.permalink_url },
      }
    } catch (error) {
      log.error({ err: error }, 'task creation failed')

      return deliveryError(error)
    }
  },
}
