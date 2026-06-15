/**
 * ntfy hook handler.
 * POSTs a push notification to an ntfy topic URL.
 */
import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { safeFetch } from '../../content/ssrf-guard'
import { getErrorMessage } from '../message-utils'
import { buildNtfyPayload } from './message'
import { parseNtfyUrl } from './url'

export interface NtfyTarget {
  channelId: string // full ntfy URL, e.g. https://ntfy.sh/<topic>
}

export interface NtfyConfig {
  accessToken?: string // optional Bearer token (empty string when none)
  rootUrl: string
}

export const ntfyHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId } = target as NtfyTarget
    const { accessToken, rootUrl } = config as NtfyConfig

    const parsed = parseNtfyUrl(channelId)
    if (!parsed) {
      return { success: false, error: 'Invalid ntfy URL or topic', shouldRetry: false }
    }
    const { origin, topic } = parsed

    const payload = buildNtfyPayload(event, topic, rootUrl)
    if (!payload) return { success: true } // event type we do not notify on

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

    console.log(`[ntfy] Processing ${event.type} → topic ${topic}`)
    try {
      const response = await safeFetch(`${origin}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const status = response.status
        console.error(`[ntfy] ❌ ntfy returned ${status}`)
        return { success: false, error: `ntfy returned ${status}`, shouldRetry: status === 429 || status >= 500 }
      }
      console.log(`[ntfy] ✅ delivered`)
      return { success: true }
    } catch (error) {
      const errorMsg = getErrorMessage(error)
      console.error(`[ntfy] ❌ Exception: ${errorMsg}`)
      return { success: false, error: errorMsg, shouldRetry: isRetryableError(error) }
    }
  },
}
