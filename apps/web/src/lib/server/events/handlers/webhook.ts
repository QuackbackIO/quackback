/**
 * Webhook hook handler.
 * Delivers events to external HTTP endpoints with HMAC signing.
 *
 * Retries and failure counting are handled by BullMQ in process.ts.
 * This handler only resets failureCount on success.
 */

import crypto from 'crypto'
import type { HookHandler, HookResult, HookRunContext } from '../hook-types'
import type { EventData } from '../types'
import type { WebhookTarget, WebhookConfig } from '../integrations/webhook/constants'
import type { WebhookId } from '@quackback/ids'
import { safeFetch, SsrfError, TimeoutError } from '@/lib/server/content/ssrf-guard'
import { isRetryableError } from '../hook-utils'
import { claimHookDelivery } from '../hook-idempotency'
import { logger } from '@/lib/server/logger'

export type { WebhookTarget, WebhookConfig }

const log = logger.child({ component: 'webhook' })

const TIMEOUT_MS = 5_000 // 5s timeout for single attempt
const USER_AGENT = 'Quackback-Webhook/1.0 (+https://quackback.io)'

export const webhookHook: HookHandler = {
  async run(
    event: EventData,
    target: unknown,
    config: unknown,
    ctx?: HookRunContext
  ): Promise<HookResult> {
    const { url } = target as WebhookTarget
    const { secret, webhookId } = config as WebhookConfig

    // Idempotency: if BullMQ is re-running this job after a worker crash,
    // skip the delivery — the previous attempt already POSTed (and the
    // remote saw it). Without this, customers see duplicate webhook
    // deliveries on every rolling restart that interrupts a worker.
    const claimed = await claimHookDelivery(ctx?.jobId, 'webhook')
    if (!claimed) {
      log.debug({ job_id: ctx?.jobId, url }, 'skipping duplicate delivery')
      return { success: true }
    }

    log.debug({ event_type: event.type, url }, 'processing webhook')

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

    try {
      // safeFetch is the single SSRF chokepoint: it validates the host, then
      // pins the connection to the validated IP (no second DNS resolution),
      // closing the TOCTOU the bare fetch left open, and never follows a
      // redirect. Replaces this handler's own divergent private-IP guard.
      const response = await safeFetch(url, {
        method: 'POST',
        headers,
        body: payload,
        timeoutMs: TIMEOUT_MS,
      })

      if (response.ok) {
        log.info({ event_type: event.type, url }, 'webhook delivered')
        await updateWebhookSuccess(webhookId)
        return { success: true }
      }

      // Non-2xx response
      const error = `HTTP ${response.status}`
      log.warn({ url, status: response.status }, 'webhook delivery failed')
      const retryable = response.status >= 500 || response.status === 429
      return { success: false, error, shouldRetry: retryable }
    } catch (error) {
      // An SSRF-blocked target (private/internal IP, bad scheme) never becomes
      // valid on retry — fail permanently, as the old pre-check did.
      if (error instanceof SsrfError) {
        log.error({ url, reason: error.message }, 'ssrf blocked')
        return { success: false, error: error.message, shouldRetry: false }
      }
      // A timeout is transient — retry.
      if (error instanceof TimeoutError) {
        log.warn({ url }, 'webhook delivery timed out')
        return { success: false, error: 'Request timeout', shouldRetry: true }
      }

      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error, url }, 'webhook delivery failed')
      const retryable = isRetryableError(error)
      return { success: false, error: errorMsg, shouldRetry: retryable }
    }
  },
}

/**
 * Update webhook on successful delivery.
 */
async function updateWebhookSuccess(webhookId: WebhookId): Promise<void> {
  try {
    const { db, webhooks, eq } = await import('@/lib/server/db')
    await db
      .update(webhooks)
      .set({
        failureCount: 0,
        lastTriggeredAt: new Date(),
        lastError: null,
      })
      .where(eq(webhooks.id, webhookId))
  } catch (error) {
    log.error({ err: error, webhook_id: webhookId }, 'failed to update webhook success status')
  }
}
