/**
 * Trello hook handler.
 * Creates cards in Trello when events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildTrelloCard } from './message'

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

    console.log(`[Trello] Processing ${event.type} → list ${listId}`)

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
          console.error(`[Trello] ❌ Auth error (${status}): ${errorBody}`)
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect Trello.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          console.warn(`[Trello] ⚠️ Rate limited: ${errorBody}`)
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        console.error(`[Trello] ❌ API error (${status}): ${errorBody}`)
        return {
          success: false,
          error: `Trello API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as { id: string; shortUrl: string }
      console.log(`[Trello] ✅ Created card ${data.id}`)

      return { success: true, externalId: data.id, externalUrl: data.shortUrl }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Trello] ❌ Exception: ${errorMsg}`)

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
