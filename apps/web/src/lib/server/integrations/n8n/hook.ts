/**
 * n8n hook handler.
 * Sends event payloads to an n8n webhook URL.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildN8nPayload } from './message'

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

    console.log(`[n8n] Processing ${event.type} → webhook`)

    const payload = buildN8nPayload(event, rootUrl)

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const status = response.status
        console.error(`[n8n] ❌ Webhook returned ${status}`)

        return {
          success: false,
          error: `Webhook returned ${status}`,
          shouldRetry: status === 429 || status >= 500,
        }
      }

      console.log(`[n8n] ✅ Webhook delivered`)
      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[n8n] ❌ Exception: ${errorMsg}`)

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
