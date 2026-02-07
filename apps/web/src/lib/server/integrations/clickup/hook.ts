/**
 * ClickUp hook handler.
 * Creates ClickUp tasks when feedback events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildClickUpTaskBody } from './message'

const CLICKUP_API = 'https://api.clickup.com/api/v2'

export interface ClickUpTarget {
  channelId: string // listId is stored as channelId for consistency
}

export interface ClickUpConfig {
  accessToken: string
  rootUrl: string
}

export const clickupHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: listId } = target as ClickUpTarget
    const { accessToken, rootUrl } = config as ClickUpConfig

    // Only create tasks for new feedback
    if (event.type !== 'post.created') {
      return { success: true }
    }

    console.log(`[ClickUp] Creating task for ${event.type} → list ${listId}`)

    const { name, description } = buildClickUpTaskBody(event, rootUrl)

    try {
      const response = await fetch(`${CLICKUP_API}/list/${listId}/task`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
      })

      if (!response.ok) {
        const status = response.status

        if (status === 401) {
          return {
            success: false,
            error: 'Authentication failed. Please reconnect ClickUp.',
            shouldRetry: false,
          }
        }

        if (status === 429) {
          return {
            success: false,
            error: 'Rate limited by ClickUp',
            shouldRetry: true,
          }
        }

        if (status >= 500) {
          const errorText = await response.text()
          return {
            success: false,
            error: `ClickUp server error (${status}): ${errorText}`,
            shouldRetry: true,
          }
        }

        const errorText = await response.text()
        return {
          success: false,
          error: `ClickUp API error (${status}): ${errorText}`,
          shouldRetry: false,
        }
      }

      const task = (await response.json()) as { id: string; url: string }

      console.log(`[ClickUp] Created task ${task.id}`)
      return { success: true, externalId: task.id, externalUrl: task.url }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
