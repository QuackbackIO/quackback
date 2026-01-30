/**
 * Webhook hook handler.
 * Delivers events to external HTTP endpoints with HMAC signing.
 */

import crypto from 'crypto'
import type { HookHandler, HookResult } from '../types'
import type { WebhookId } from '@quackback/ids'
import type { EventData } from '@/lib/events/types'

export interface WebhookTarget {
  url: string
}

export interface WebhookConfig {
  secret: string
  webhookId: WebhookId
}

const TIMEOUT_MS = 10_000
const RETRY_DELAYS = [1000, 5000, 30_000] // 1s, 5s, 30s
const USER_AGENT = 'Quackback-Webhook/1.0 (+https://quackback.io)'
const MAX_FAILURES = 50

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const webhookHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { url } = target as WebhookTarget
    const { secret, webhookId } = config as WebhookConfig

    console.log(`[Webhook] Processing ${event.type} → ${url}`)

    // Build payload
    const payload = JSON.stringify({
      id: `evt_${crypto.randomUUID().replace(/-/g, '')}`,
      type: event.type,
      createdAt: event.timestamp,
      data: event.data,
    })

    // Create HMAC signature
    const timestamp = Math.floor(Date.now() / 1000)
    const signaturePayload = `${timestamp}.${payload}`
    const signature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex')

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-Quackback-Signature': `sha256=${signature}`,
      'X-Quackback-Timestamp': String(timestamp),
      'X-Quackback-Event': event.type,
    }

    // Sync retries with exponential backoff
    let lastError: string | undefined

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: payload,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          console.log(`[Webhook] ✅ Delivered to ${url} (attempt ${attempt + 1})`)
          // Success - reset failure count
          await updateWebhookSuccess(webhookId)
          return { success: true }
        }

        // 4xx = client error, don't retry (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          lastError = `HTTP ${response.status}`
          console.log(`[Webhook] ❌ Client error ${response.status}, not retrying`)
          break
        }

        // 5xx or 429 = retry
        lastError = `HTTP ${response.status}`
        console.log(`[Webhook] ⚠️ Server error ${response.status}, will retry`)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = 'Request timeout'
          console.log(`[Webhook] ⚠️ Timeout, will retry`)
        } else {
          lastError = error instanceof Error ? error.message : 'Unknown error'
          console.log(`[Webhook] ⚠️ Error: ${lastError}, will retry`)
        }
      }

      // Wait before retry (unless last attempt)
      if (attempt < RETRY_DELAYS.length) {
        console.log(`[Webhook] Waiting ${RETRY_DELAYS[attempt]}ms before retry`)
        await sleep(RETRY_DELAYS[attempt])
      }
    }

    // All retries failed
    console.error(`[Webhook] ❌ All retries failed for ${url}: ${lastError}`)
    await updateWebhookFailure(webhookId, lastError)

    return { success: false, error: lastError, shouldRetry: false }
  },
}

/**
 * Update webhook on successful delivery.
 */
async function updateWebhookSuccess(webhookId: WebhookId): Promise<void> {
  try {
    const { db, webhooks, eq } = await import('@/lib/db')
    await db
      .update(webhooks)
      .set({
        failureCount: 0,
        lastTriggeredAt: new Date(),
        lastError: null,
      })
      .where(eq(webhooks.id, webhookId))
  } catch (error) {
    console.error('[Webhook] Failed to update success status:', error)
  }
}

/**
 * Update webhook on failed delivery. Auto-disable after MAX_FAILURES.
 */
async function updateWebhookFailure(
  webhookId: WebhookId,
  error: string | undefined
): Promise<void> {
  try {
    const { db, webhooks, eq, sql } = await import('@/lib/db')

    // Increment failure count and potentially disable
    await db
      .update(webhooks)
      .set({
        failureCount: sql`${webhooks.failureCount} + 1`,
        lastTriggeredAt: new Date(),
        lastError: error ?? 'Unknown error',
        // Auto-disable after MAX_FAILURES consecutive failures
        status: sql`CASE WHEN ${webhooks.failureCount} + 1 >= ${MAX_FAILURES} THEN 'disabled' ELSE ${webhooks.status} END`,
      })
      .where(eq(webhooks.id, webhookId))
  } catch (err) {
    console.error('[Webhook] Failed to update failure status:', err)
  }
}
