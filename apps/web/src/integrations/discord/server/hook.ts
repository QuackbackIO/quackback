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
import { hookLinks } from '@/lib/server/integrations/message-utils'
import type { SectionOrigins } from '@/lib/shared/section-links'

const log = logger.child({ component: 'discord' })

const DISCORD_API = 'https://discord.com/api/v10'

export interface DiscordTarget {
  channelId: string
}

export interface DiscordConfig {
  accessToken: string
  rootUrl: string
  links?: SectionOrigins
  integrationId: string
}

export const discordHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId } = target as DiscordTarget
    const { accessToken, rootUrl, links, integrationId } = config as DiscordConfig

    const { supportAlertHold } = await import('@/lib/server/integrations/support-alerts')
    const held = await supportAlertHold(event, { integrationId, channelId })
    if (held) {
      log.debug({ event_type: event.type, reason: held }, 'support notice held back')
      return { state: 'succeeded' }
    }

    log.debug({ event_type: event.type, channel_id: channelId }, 'processing event')

    const message = buildDiscordMessage(event, hookLinks({ rootUrl, links }))
    if (!message) {
      log.debug({ event_type: event.type }, 'event produces no discord message, skipping')
      return { state: 'succeeded' }
    }

    try {
      const response = await integrationFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${accessToken}`,
          'Content-Type': 'application/json',
        },
        // Customer text is quoted in posts: never let it ping anyone.
        body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } }),
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
