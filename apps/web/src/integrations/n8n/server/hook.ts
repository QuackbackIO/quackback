import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
/**
 * n8n hook handler.
 * Sends event payloads to an n8n webhook URL.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import { buildN8nPayload } from '@/integrations/n8n/server/message'

const log = logger.child({ component: 'n8n' })

export interface N8nTarget {
  channelId: string // webhookUrl stored as channelId for consistency
}

export interface N8nConfig {
  accessToken: string
  rootUrl: string
}

export const n8nHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: webhookUrl } = target as N8nTarget
    const { rootUrl } = config as N8nConfig

    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    log.debug({ event_type: event.type }, 'processing event')

    const payload = buildN8nPayload(event, rootUrl)

    try {
      const response = await safeFetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      log.info('webhook delivered')
      return { state: 'succeeded' }
    } catch (error) {
      log.error({ err: error }, 'webhook delivery failed')

      return deliveryError(error)
    }
  },
}
