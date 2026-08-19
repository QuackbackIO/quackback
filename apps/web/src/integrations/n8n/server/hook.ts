/**
 * n8n hook handler.
 * Sends event payloads to an n8n webhook URL.
 */

import type { HookHandler, HookResult } from '@/lib/server/events/hook-types'
import type { EventData } from '@/lib/server/events/types'
import { isRetryableError } from '@/lib/server/events/hook-utils'
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

export const n8nHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: webhookUrl } = target as N8nTarget
    const { rootUrl } = config as N8nConfig

    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      return { success: false, error: 'Invalid webhook URL', shouldRetry: false }
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
        const status = response.status
        log.error({ status_code: status }, 'webhook returned error status')

        return {
          success: false,
          error: `Webhook returned ${status}`,
          shouldRetry: status === 429 || status >= 500,
        }
      }

      log.info('webhook delivered')
      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error }, 'webhook delivery failed')

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
