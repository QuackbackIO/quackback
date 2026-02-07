/**
 * Teams hook handler.
 * Sends adaptive cards to Teams channels when events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildTeamsMessage } from './message'

const GRAPH_API = 'https://graph.microsoft.com/v1.0'

export interface TeamsTarget {
  channelId: string
}

export interface TeamsConfig {
  accessToken: string
  rootUrl: string
  teamId?: string
}

export const teamsHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId } = target as TeamsTarget
    const { accessToken, rootUrl, teamId } = config as TeamsConfig

    if (!teamId) {
      return { success: false, error: 'Team ID not configured', shouldRetry: false }
    }

    console.log(`[Teams] Processing ${event.type} → channel ${channelId}`)

    const message = buildTeamsMessage(event, rootUrl)

    try {
      const response = await fetch(`${GRAPH_API}/teams/${teamId}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const status = response.status

        if (status === 401 || status === 403) {
          console.error(`[Teams] ❌ Auth error (${status}): ${errorBody}`)
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect Teams.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          console.warn(`[Teams] ⚠️ Rate limited: ${errorBody}`)
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        console.error(`[Teams] ❌ API error (${status}): ${errorBody}`)
        return {
          success: false,
          error: `Teams API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as { id: string }
      console.log(`[Teams] ✅ Posted to ${channelId} (id=${data.id})`)

      return { success: true, externalId: data.id }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Teams] ❌ Exception: ${errorMsg}`)

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
