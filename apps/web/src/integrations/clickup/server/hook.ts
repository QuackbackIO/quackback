import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * ClickUp hook handler.
 * Creates ClickUp tasks when feedback events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildClickUpTaskBody } from '@/integrations/clickup/server/message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'clickup' })

const CLICKUP_API = 'https://api.clickup.com/api/v2'

export interface ClickUpTarget {
  channelId: string // listId is stored as channelId for consistency
}

export interface ClickUpConfig {
  accessToken: string
  rootUrl: string
}

export const clickupHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: listId } = target as ClickUpTarget
    const { accessToken, rootUrl } = config as ClickUpConfig

    // Only create tasks for new feedback
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    log.debug({ event_type: event.type, list_id: listId }, 'creating task')

    const { name, description } = buildClickUpTaskBody(event, rootUrl)

    try {
      const response = await integrationFetch(`${CLICKUP_API}/list/${listId}/task`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
      })

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const task = (await response.json()) as { id: string; url: string }

      log.info({ task_id: task.id }, 'task created')
      return { state: 'succeeded', result: { externalId: task.id, externalUrl: task.url } }
    } catch (error) {
      return deliveryError(error)
    }
  },
}
