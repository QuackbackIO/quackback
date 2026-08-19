/**
 * Trello hook handler.
 * Creates cards in Trello when events occur.
 */

import type { HookHandler, HookResult } from '@/lib/server/events/hook-types'
import type { EventData } from '@/lib/server/events/types'
import { isRetryableError } from '@/lib/server/events/hook-utils'
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

export const trelloHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created') {
      return { success: true }
    }

    const { channelId: listId } = target as TrelloTarget
    const { accessToken, rootUrl, apiKey } = config as TrelloConfig

    if (!apiKey) {
      return { success: false, error: 'Trello API key missing from config', shouldRetry: false }
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

      const response = await fetch(`${TRELLO_API}/cards?${params}`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const status = response.status

        if (status === 401) {
          log.error({ status_code: status, list_id: listId, body: errorBody }, 'auth error')
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect Trello.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          log.warn({ status_code: status, list_id: listId, body: errorBody }, 'rate limited')
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        log.error({ status_code: status, list_id: listId, body: errorBody }, 'api error')
        return {
          success: false,
          error: `Trello API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as { id: string; shortUrl: string }
      log.info({ card_id: data.id, list_id: listId }, 'card created')

      return { success: true, externalId: data.id, externalUrl: data.shortUrl }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error, list_id: listId }, 'card creation failed')

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken, apiKey } = config as TrelloConfig
    try {
      const response = await fetch(
        `${TRELLO_API}/members/me?key=${apiKey}&token=${accessToken}&fields=id`
      )
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
