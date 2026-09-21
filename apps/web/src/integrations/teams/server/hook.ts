import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Teams hook handler.
 * Sends adaptive cards to Teams channels when events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildTeamsMessage } from '@/integrations/teams/server/message'
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

export const teamsHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId } = target as TeamsTarget
    const { accessToken, rootUrl, teamId } = config as TeamsConfig

    if (!teamId) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    log.debug({ event_type: event.type, channel_id: channelId }, 'processing event')

    const message = buildTeamsMessage(event, rootUrl)

    try {
      const response = await integrationFetch(
        `${GRAPH_API}/teams/${teamId}/channels/${channelId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        }
      )

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
}
