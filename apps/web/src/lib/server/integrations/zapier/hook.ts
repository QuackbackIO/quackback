/**
 * Zapier hook handler.
 * Sends event payloads to a Zapier webhook URL.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { safeFetch } from '../../content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import { buildZapierPayload } from './message'

const log = logger.child({ component: 'zapier' })

export interface ZapierTarget {
  channelId: string // webhookUrl stored as channelId for consistency
}

export interface ZapierConfig {
  accessToken: string // not used, but present from targets system
  rootUrl: string
}

export const zapierHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: webhookUrl } = target as ZapierTarget
    const { rootUrl } = config as ZapierConfig

    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      return { success: false, error: 'Invalid webhook URL', shouldRetry: false }
    }

    // Only allow Zapier webhook domains to prevent SSRF / data exfiltration
    try {
      const url = new URL(webhookUrl)
      if (url.hostname !== 'hooks.zapier.com') {
        return {
          success: false,
          error: 'Webhook URL must be a hooks.zapier.com URL',
          shouldRetry: false,
        }
      }
    } catch {
      return { success: false, error: 'Invalid webhook URL', shouldRetry: false }
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
        const status = response.status
        log.error({ status_code: status }, 'webhook returned error status')

        if (status === 404 || status === 410) {
          return {
            success: false,
            error: 'Zap is no longer active. Please update or re-enable the Zap in Zapier.',
            shouldRetry: false,
          }
        }

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
