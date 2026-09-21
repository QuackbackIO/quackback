import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Notion hook handler.
 * Creates database items in Notion when events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildNotionPage } from '@/integrations/notion/server/message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'notion' })

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

export interface NotionTarget {
  channelId: string // databaseId stored as channelId for consistency
}

export interface NotionConfig {
  accessToken: string
  rootUrl: string
}

export const notionHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    const { channelId: databaseId } = target as NotionTarget
    const { accessToken, rootUrl } = config as NotionConfig

    log.debug({ event_type: event.type, database_id: databaseId }, 'processing event')

    const { title, blocks } = buildNotionPage(event, rootUrl)

    try {
      const response = await integrationFetch(`${NOTION_API}/pages`, {
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
        return httpDeliveryFailure(response)
      }

      const data = (await response.json()) as { id: string; url: string }
      log.info({ page_id: data.id }, 'created page')

      return { state: 'succeeded', result: { externalId: data.id, externalUrl: data.url } }
    } catch (error) {
      log.error({ err: error }, 'exception')

      return deliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as NotionConfig
    try {
      const response = await integrationFetch(`${NOTION_API}/users/me`, {
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
