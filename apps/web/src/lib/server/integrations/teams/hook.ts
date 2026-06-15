/**
 * Teams hook handler.
 * Sends adaptive cards to Teams channels when events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildTeamsMessage } from './message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'teams' })

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

    log.debug({ event_type: event.type, channel_id: channelId }, 'processing event')

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
          log.error({ status_code: status, channel_id: channelId, body: errorBody }, 'auth error')
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect Teams.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          log.warn({ status_code: status, channel_id: channelId, body: errorBody }, 'rate limited')
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        log.error({ status_code: status, channel_id: channelId, body: errorBody }, 'api error')
        return {
          success: false,
          error: `Teams API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as { id: string }
      log.info({ channel_id: channelId, message_id: data.id }, 'message posted')

      return { success: true, externalId: data.id }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error, channel_id: channelId }, 'message delivery failed')

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
