import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
/**
 * ntfy hook handler.
 * POSTs a push notification to an ntfy topic URL.
 */
import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { buildNtfyPayload } from '@/integrations/ntfy/server/message'
import { parseNtfyUrl } from '@/integrations/ntfy/server/url'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ntfy' })

export interface NtfyTarget {
  channelId: string // full ntfy URL, e.g. https://ntfy.sh/<topic>
}

export interface NtfyConfig {
  accessToken?: string // optional Bearer token (empty string when none)
  rootUrl: string
}

export const ntfyHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId } = target as NtfyTarget
    const { accessToken, rootUrl } = config as NtfyConfig

    const parsed = parseNtfyUrl(channelId)
    if (!parsed) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }
    const { origin, topic } = parsed

    const payload = buildNtfyPayload(event, topic, rootUrl)
    if (!payload) return { state: 'succeeded' } // event type we do not notify on

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

    log.debug({ event_type: event.type, topic }, 'processing notification')
    try {
      const response = await safeFetch(`${origin}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        return httpDeliveryFailure(response)
      }
      log.info({ topic }, 'notification delivered')
      return { state: 'succeeded' }
    } catch (error) {
      log.error({ err: error }, 'ntfy request failed')
      return deliveryError(error)
    }
  },
}
