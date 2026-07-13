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
import {
  claimHookDelivery,
  completeHookDelivery,
  failHookDelivery,
  releaseHookDelivery,
} from '../hook-idempotency'
import { db, webhooks, eq } from '@/lib/server/db'
import { decryptWebhookSecret } from '@/lib/server/domains/webhooks/encryption'
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
    const { webhookId } = config as WebhookConfig

    // Idempotency: if BullMQ is re-running this job after a worker crash,
    // skip the delivery — the previous attempt already POSTed (and the
    // remote saw it). Without this, customers see duplicate webhook
    // deliveries on every rolling restart that interrupts a worker.
    const claimed = await claimHookDelivery(ctx?.jobId, 'webhook')
    if (!claimed) {
      log.debug({ job_id: ctx?.jobId, webhook_id: webhookId }, 'skipping duplicate delivery')
      return { success: true }
    }

    // Delivery-time re-validation (mirrors the app-webhook hook): the
    // enqueue-time snapshot — including the queued target URL — is superseded
    // by the live row, so a webhook disabled, soft-deleted, or re-pointed
    // between enqueue and delivery (or during BullMQ retries) is honored.
    // The signing secret also never travels in the job payload (it would
    // otherwise sit in plaintext in Redis for the job's lifetime) — it's
    // loaded and decrypted here, right before it's needed.
    let secret: string
    let url: string
    try {
      const row = await db.query.webhooks.findFirst({
        where: eq(webhooks.id, webhookId),
        columns: { secret: true, url: true, status: true, deletedAt: true },
      })
      if (!row || row.status !== 'active' || row.deletedAt !== null) {
        // Deleted or disabled after this delivery was enqueued — a retry
        // can't make it deliverable again.
        log.warn({ webhook_id: webhookId }, 'webhook no longer deliverable, skipping')
        await failHookDelivery(ctx?.jobId)
        return { success: false, error: 'Webhook not deliverable', shouldRetry: false }
      }
      secret = decryptWebhookSecret(row.secret)
      url = row.url
    } catch (error) {
      log.error({ err: error, webhook_id: webhookId }, 'failed to load webhook secret')
      await releaseHookDelivery(ctx?.jobId)
      return { success: false, error: 'Failed to load webhook secret', shouldRetry: true }
    }

    log.debug({ event_type: event.type, url }, 'processing webhook')

    // Build payload
    const payload = JSON.stringify({
      // Stable across BullMQ attempts so receivers can also deduplicate the
      // narrow crash-after-POST-before-ack window.
      id: event.id,
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
        await completeHookDelivery(ctx?.jobId)
        await updateWebhookSuccess(webhookId)
        return { success: true }
      }

      // Non-2xx response
      const error = `HTTP ${response.status}`
      log.warn({ url, status: response.status }, 'webhook delivery failed')
      const retryable = response.status >= 500 || response.status === 429
      if (retryable) await releaseHookDelivery(ctx?.jobId)
      else await failHookDelivery(ctx?.jobId)
      return { success: false, error, shouldRetry: retryable }
    } catch (error) {
      // An SSRF-blocked target (private/internal IP, bad scheme) never becomes
      // valid on retry — fail permanently, as the old pre-check did.
      if (error instanceof SsrfError) {
        log.error({ url, reason: error.message }, 'ssrf blocked')
        await failHookDelivery(ctx?.jobId)
        return { success: false, error: error.message, shouldRetry: false }
      }
      // A timeout is transient — retry.
      if (error instanceof TimeoutError) {
        log.warn({ url }, 'webhook delivery timed out')
        await releaseHookDelivery(ctx?.jobId)
        return { success: false, error: 'Request timeout', shouldRetry: true }
      }

      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error, url }, 'webhook delivery failed')
      const retryable = isRetryableError(error)
      if (retryable) await releaseHookDelivery(ctx?.jobId)
      else await failHookDelivery(ctx?.jobId)
      return { success: false, error: errorMsg, shouldRetry: retryable }
    }
  },
}

/**
 * Update webhook on successful delivery.
 */
async function updateWebhookSuccess(webhookId: WebhookId): Promise<void> {
  try {
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
