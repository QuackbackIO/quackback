import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Monday.com hook handler.
 * Creates items in Monday.com when events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildMondayItem } from '@/integrations/monday/server/message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'monday' })

const MONDAY_API = 'https://api.monday.com/v2'

export interface MondayTarget {
  channelId: string // boardId stored as channelId for consistency
}

export interface MondayConfig {
  accessToken: string
  rootUrl: string
  groupId?: string
}

export const mondayHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    const { channelId: boardId } = target as MondayTarget
    const { accessToken, rootUrl, groupId } = config as MondayConfig

    log.debug({ event_type: event.type, board_id: boardId }, 'processing event')

    const { name, updateBody } = buildMondayItem(event, rootUrl)

    try {
      const groupArg = groupId ? `, group_id: "${groupId}"` : ''
      const query = `mutation {
        create_item(board_id: ${boardId}, item_name: ${JSON.stringify(name)}${groupArg}) {
          id
        }
      }`

      const response = await integrationFetch(MONDAY_API, {
        method: 'POST',
        headers: {
          Authorization: accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      })

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const data = (await response.json()) as {
        data?: { create_item?: { id: string } }
        errors?: Array<{ message: string }>
      }

      if (data.errors?.length) {
        const errorMsg = data.errors[0].message
        log.error({ error_message: errorMsg }, 'graphql error')
        return { state: 'uncertain', errorCode: 'outcome_unknown' }
      }

      const itemId = data.data?.create_item?.id
      if (!itemId) {
        return { state: 'uncertain', errorCode: 'outcome_unknown' }
      }

      // Add update with description
      if (updateBody) {
        const update = await integrationFetch(MONDAY_API, {
          method: 'POST',
          headers: {
            Authorization: accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(updateBody)}) { id } }`,
          }),
        })
        if (!update.ok) return { state: 'uncertain', errorCode: 'outcome_unknown' }
        const result = (await update.json()) as {
          data?: { create_update?: { id: string } }
          errors?: unknown[]
        }
        if (result.errors?.length || !result.data?.create_update?.id)
          return { state: 'uncertain', errorCode: 'outcome_unknown' }
      }

      log.info({ item_id: itemId }, 'created item')
      return { state: 'succeeded', result: { externalId: itemId } }
    } catch (error) {
      log.error({ err: error }, 'exception')

      return deliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as MondayConfig
    try {
      const response = await integrationFetch(MONDAY_API, {
        method: 'POST',
        headers: {
          Authorization: accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '{ me { id } }' }),
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
