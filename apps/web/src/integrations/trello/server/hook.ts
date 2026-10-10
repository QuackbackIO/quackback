import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Trello hook handler.
 * Creates cards in Trello when events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildTrelloCard } from '@/integrations/trello/server/message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'trello' })

const TRELLO_API = 'https://api.trello.com/1'

export interface TrelloTarget {
  channelId: string // listId stored as channelId for consistency
}

export interface TrelloConfig {
  accessToken: string
  rootUrl: string
  apiKey?: string
}

export const trelloHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    const { channelId: listId } = target as TrelloTarget
    const { accessToken, rootUrl, apiKey } = config as TrelloConfig

    if (!apiKey) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    log.debug({ event_type: event.type, list_id: listId }, 'processing event')

    const { name, desc } = buildTrelloCard(event, rootUrl)

    try {
      const params = new URLSearchParams({
        idList: listId,
        name,
        desc,
        pos: 'top',
        key: apiKey,
        token: accessToken,
      })

      const response = await integrationFetch(`${TRELLO_API}/cards?${params}`, {
        method: 'POST',
      })

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const data = (await response.json()) as { id: string; shortUrl: string }
      log.info({ card_id: data.id, list_id: listId }, 'card created')

      return { state: 'succeeded', result: { externalId: data.id, externalUrl: data.shortUrl } }
    } catch (error) {
      log.error({ err: error, list_id: listId }, 'card creation failed')

      return deliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken, apiKey } = config as TrelloConfig
    try {
      const response = await integrationFetch(
        `${TRELLO_API}/members/me?key=${apiKey}&token=${accessToken}&fields=id`
      )
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
