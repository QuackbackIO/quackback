import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
/**
 * Zapier hook handler.
 * Sends event payloads to a Zapier webhook URL.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import { buildZapierPayload } from '@/integrations/zapier/server/message'

const log = logger.child({ component: 'zapier' })

export interface ZapierTarget {
  channelId: string // webhookUrl stored as channelId for consistency
}

export interface ZapierConfig {
  accessToken: string // not used, but present from targets system
  rootUrl: string
}

export const zapierHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: webhookUrl } = target as ZapierTarget
    const { rootUrl } = config as ZapierConfig

    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    // Only allow Zapier webhook domains to prevent SSRF / data exfiltration
    try {
      const url = new URL(webhookUrl)
      if (url.hostname !== 'hooks.zapier.com') {
        return { state: 'failed', errorCode: 'provider_failed' }
      }
    } catch {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    log.debug({ event_type: event.type }, 'processing event')

    const payload = buildZapierPayload(event, rootUrl)

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
