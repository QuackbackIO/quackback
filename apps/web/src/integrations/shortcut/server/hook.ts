import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Shortcut hook handler.
 * Creates Shortcut stories when feedback events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildShortcutStoryBody } from '@/integrations/shortcut/server/message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'shortcut' })

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3'

export interface ShortcutTarget {
  channelId: string // group (team) ID stored as channelId for consistency
}

export interface ShortcutConfig {
  accessToken: string
  rootUrl: string
}

interface ShortcutStoryResponse {
  id: number
  app_url: string
}

export const shortcutHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: groupId } = target as ShortcutTarget
    const { accessToken, rootUrl } = config as ShortcutConfig

    // Only create stories for new feedback
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    log.debug({ event_type: event.type, group_id: groupId }, 'creating story')

    const { title, description } = buildShortcutStoryBody(event, rootUrl)

    try {
      const response = await integrationFetch(`${SHORTCUT_API}/stories`, {
        method: 'POST',
        headers: {
          'Shortcut-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: title,
          description,
          group_id: groupId,
          story_type: 'feature',
        }),
      })

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const story = (await response.json()) as ShortcutStoryResponse

      log.info({ story_id: story.id, group_id: groupId }, 'story created')
      return {
        state: 'succeeded',
        result: { externalId: String(story.id), externalUrl: story.app_url },
      }
    } catch (error) {
      return deliveryError(error)
    }
  },
}
