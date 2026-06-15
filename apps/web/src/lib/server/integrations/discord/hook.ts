/**
 * Discord hook handler.
 * Sends messages to Discord channels when events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildDiscordMessage } from './message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'discord' })

const DISCORD_API = 'https://discord.com/api/v10'

export interface DiscordTarget {
  channelId: string
}

export interface DiscordConfig {
  accessToken: string
  rootUrl: string
}

export const discordHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId } = target as DiscordTarget
    const { accessToken, rootUrl } = config as DiscordConfig

    log.debug({ event_type: event.type, channel_id: channelId }, 'processing event')

    const message = buildDiscordMessage(event, rootUrl)

    try {
      const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const status = response.status

        // Auth errors — don't retry
        if (status === 401 || status === 403) {
          log.error({ status_code: status, channel_id: channelId, body: errorBody }, 'auth error')
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect Discord.`,
            shouldRetry: false,
          }
        }

        // Rate limit
        if (status === 429) {
          log.warn({ status_code: status, channel_id: channelId, body: errorBody }, 'rate limited')
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        log.error({ status_code: status, channel_id: channelId, body: errorBody }, 'api error')
        return {
          success: false,
          error: `Discord API error: ${status}`,
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

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as DiscordConfig
    try {
      const response = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
