import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Discord hook handler.
 * Sends messages to Discord channels when events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildDiscordMessage } from '@/integrations/discord/server/message'
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

export const discordHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId } = target as DiscordTarget
    const { accessToken, rootUrl } = config as DiscordConfig

    log.debug({ event_type: event.type, channel_id: channelId }, 'processing event')

    const message = buildDiscordMessage(event, rootUrl)

    try {
      const response = await integrationFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const data = (await response.json()) as { id: string }
      log.info({ channel_id: channelId, message_id: data.id }, 'message posted')

      return { state: 'succeeded', result: { externalId: data.id } }
    } catch (error) {
      log.error({ err: error, channel_id: channelId }, 'message delivery failed')

      return deliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as DiscordConfig
    try {
      const response = await integrationFetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
