/**
 * Monday.com hook handler.
 * Creates items in Monday.com when events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildMondayItem } from './message'

const MONDAY_API = 'https://api.monday.com/v2'

export interface MondayTarget {
  channelId: string // boardId stored as channelId for consistency
}

export interface MondayConfig {
  accessToken: string
  rootUrl: string
  groupId?: string
}

export const mondayHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created') {
      return { success: true }
    }

    const { channelId: boardId } = target as MondayTarget
    const { accessToken, rootUrl, groupId } = config as MondayConfig

    console.log(`[Monday] Processing ${event.type} → board ${boardId}`)

    const { name, updateBody } = buildMondayItem(event, rootUrl)

    try {
      const groupArg = groupId ? `, group_id: "${groupId}"` : ''
      const query = `mutation {
        create_item(board_id: ${boardId}, item_name: ${JSON.stringify(name)}${groupArg}) {
          id
        }
      }`

      const response = await fetch(MONDAY_API, {
        method: 'POST',
        headers: {
          Authorization: accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const status = response.status

        if (status === 401 || status === 403) {
          console.error(`[Monday] ❌ Auth error (${status}): ${errorBody}`)
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect Monday.com.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          console.warn(`[Monday] ⚠️ Rate limited`)
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        console.error(`[Monday] ❌ API error (${status}): ${errorBody}`)
        return {
          success: false,
          error: `Monday.com API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as {
        data?: { create_item?: { id: string } }
        errors?: Array<{ message: string }>
      }

      if (data.errors?.length) {
        const errorMsg = data.errors[0].message
        console.error(`[Monday] ❌ GraphQL error: ${errorMsg}`)
        return { success: false, error: errorMsg, shouldRetry: false }
      }

      const itemId = data.data?.create_item?.id
      if (!itemId) {
        return { success: false, error: 'No item ID returned', shouldRetry: false }
      }

      // Add update with description
      if (updateBody) {
        await fetch(MONDAY_API, {
          method: 'POST',
          headers: {
            Authorization: accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(updateBody)}) { id } }`,
          }),
        })
      }

      console.log(`[Monday] ✅ Created item ${itemId}`)
      return { success: true, externalId: itemId }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Monday] ❌ Exception: ${errorMsg}`)

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as MondayConfig
    try {
      const response = await fetch(MONDAY_API, {
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
