/**
 * Make hook handler.
 * Sends event payloads to a Make webhook URL.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { safeFetch } from '../../content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import { buildMakePayload } from './message'

const log = logger.child({ component: 'make' })

export interface MakeTarget {
  channelId: string // webhookUrl stored as channelId for consistency
}

export interface MakeConfig {
  accessToken: string
  rootUrl: string
}

export const makeHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: webhookUrl } = target as MakeTarget
    const { rootUrl } = config as MakeConfig

    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      return { success: false, error: 'Invalid webhook URL', shouldRetry: false }
    }

    // Only allow Make webhook domains
    try {
      const url = new URL(webhookUrl)
      if (!url.hostname.endsWith('.make.com') && !url.hostname.endsWith('.integromat.com')) {
        return {
          success: false,
          error: 'Webhook URL must be a Make (make.com) URL',
          shouldRetry: false,
        }
      }
    } catch {
      return { success: false, error: 'Invalid webhook URL', shouldRetry: false }
    }

    log.debug({ event_type: event.type }, 'processing event')

    const payload = buildMakePayload(event, rootUrl)

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
