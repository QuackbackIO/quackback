/**
 * Notion hook handler.
 * Creates database items in Notion when events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildNotionPage } from './message'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

export interface NotionTarget {
  channelId: string // databaseId stored as channelId for consistency
}

export interface NotionConfig {
  accessToken: string
  rootUrl: string
}

export const notionHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created') {
      return { success: true }
    }

    const { channelId: databaseId } = target as NotionTarget
    const { accessToken, rootUrl } = config as NotionConfig

    console.log(`[Notion] Processing ${event.type} → database ${databaseId}`)

    const { title, blocks } = buildNotionPage(event, rootUrl)

    try {
      const response = await fetch(`${NOTION_API}/pages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: {
            title: {
              title: [{ text: { content: title } }],
            },
          },
          children: blocks,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const status = response.status

        if (status === 401 || status === 403) {
          console.error(`[Notion] ❌ Auth error (${status}): ${errorBody}`)
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect Notion.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          console.warn(`[Notion] ⚠️ Rate limited: ${errorBody}`)
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        console.error(`[Notion] ❌ API error (${status}): ${errorBody}`)
        return {
          success: false,
          error: `Notion API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as { id: string; url: string }
      console.log(`[Notion] ✅ Created page ${data.id}`)

      return { success: true, externalId: data.id, externalUrl: data.url }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Notion] ❌ Exception: ${errorMsg}`)

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as NotionConfig
    try {
      const response = await fetch(`${NOTION_API}/users/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_VERSION,
        },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
