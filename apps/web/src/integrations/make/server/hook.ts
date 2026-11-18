import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
/**
 * Make hook handler.
 * Sends event payloads to a Make webhook URL.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import { buildMakePayload } from '@/integrations/make/server/message'
import { hookLinks } from '@/lib/server/integrations/message-utils'
import type { SectionOrigins } from '@/lib/shared/section-links'

const log = logger.child({ component: 'make' })

export interface MakeTarget {
  channelId: string // webhookUrl stored as channelId for consistency
}

export interface MakeConfig {
  accessToken: string
  rootUrl: string
  links?: SectionOrigins
}

export const makeHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: webhookUrl } = target as MakeTarget
    const { rootUrl, links } = config as MakeConfig

    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    // Only allow Make webhook domains
    try {
      const url = new URL(webhookUrl)
      if (!url.hostname.endsWith('.make.com') && !url.hostname.endsWith('.integromat.com')) {
        return { state: 'failed', errorCode: 'provider_failed' }
      }
    } catch {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    log.debug({ event_type: event.type }, 'processing event')

    const payload = buildMakePayload(event, hookLinks({ rootUrl, links }))

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
