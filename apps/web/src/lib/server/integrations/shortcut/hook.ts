/**
 * Shortcut hook handler.
 * Creates Shortcut stories when feedback events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildShortcutStoryBody } from './message'

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

export const shortcutHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: groupId } = target as ShortcutTarget
    const { accessToken, rootUrl } = config as ShortcutConfig

    // Only create stories for new feedback
    if (event.type !== 'post.created') {
      return { success: true }
    }

    console.log(`[Shortcut] Creating story for ${event.type} → team ${groupId}`)

    const { title, description } = buildShortcutStoryBody(event, rootUrl)

    try {
      const response = await fetch(`${SHORTCUT_API}/stories`, {
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
        const status = response.status

        if (status === 401) {
          return {
            success: false,
            error: 'Authentication failed. Please update your Shortcut API token.',
            shouldRetry: false,
          }
        }

        if (status === 429) {
          throw Object.assign(new Error('Rate limited'), { status })
        }

        if (status >= 500) {
          throw Object.assign(new Error(`Shortcut API error: HTTP ${status}`), { status })
        }

        const body = await response.text().catch(() => '')
        return {
          success: false,
          error: `Shortcut API error: HTTP ${status} - ${body}`,
          shouldRetry: false,
        }
      }

      const story = (await response.json()) as ShortcutStoryResponse

      console.log(`[Shortcut] Created story ${story.id}`)
      return {
        success: true,
        externalId: String(story.id),
        externalUrl: story.app_url,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const status = (error as { status?: number }).status

      if (status === 401) {
        return {
          success: false,
          error: 'Authentication failed. Please update your Shortcut API token.',
          shouldRetry: false,
        }
      }

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
