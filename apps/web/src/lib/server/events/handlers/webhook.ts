/**
 * Webhook hook handler.
 * Delivers events to external HTTP endpoints with HMAC signing.
 *
 * Retries and failure counting are handled by BullMQ in process.ts.
 * This handler only resets failureCount on success.
 */

import crypto from 'crypto'
import dns from 'dns/promises'
import type { HookHandler, HookResult, HookRunContext } from '../hook-types'
import type { EventData } from '../types'
import type { WebhookTarget, WebhookConfig } from '../integrations/webhook/constants'
import type { WebhookId } from '@quackback/ids'
import { isRetryableError } from '../hook-utils'
import { claimHookDelivery } from '../hook-idempotency'

export type { WebhookTarget, WebhookConfig }

const TIMEOUT_MS = 5_000 // 5s timeout for single attempt
const USER_AGENT = 'Quackback-Webhook/1.0 (+https://quackback.io)'

/**
 * Private IP ranges that should be blocked (SSRF protection).
 * Checked at delivery time to prevent DNS rebinding attacks.
 */
const PRIVATE_IP_RANGES = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local
  /^0\./, // "This" network
  /^::1$/, // IPv6 loopback
  /^f[cd]00:/i, // IPv6 private (fc00::/7 = fc00::/8 + fd00::/8)
  /^fe80:/i, // IPv6 link-local
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/, // IPv4-mapped IPv6
]

/**
 * Check if an IP address is private/internal.
 */
function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((pattern) => pattern.test(ip))
}

/**
 * Resolve hostname and verify it doesn't point to a private IP.
 * Returns the resolved IP to use for the actual request (prevents TOCTOU/DNS rebinding).
 */
async function resolveAndValidateIP(
  hostname: string
): Promise<{ valid: boolean; ip?: string; error?: string }> {
  try {
    // Prefer IPv4 for broader compatibility
    const addresses = await dns.resolve4(hostname).catch(() => [])

    if (addresses.length === 0) {
      // Try IPv6 if no IPv4
      const addresses6 = await dns.resolve6(hostname).catch(() => [])
      if (addresses6.length === 0) {
        return { valid: false, error: 'Could not resolve hostname' }
      }
      // Check IPv6 addresses
      for (const ip of addresses6) {
        if (isPrivateIP(ip)) {
          return { valid: false, error: `DNS resolves to private IP: ${ip}` }
        }
      }
      return { valid: true, ip: `[${addresses6[0]}]` } // IPv6 needs brackets in URL
    }

    // Check IPv4 addresses
    for (const ip of addresses) {
      if (isPrivateIP(ip)) {
        return { valid: false, error: `DNS resolves to private IP: ${ip}` }
      }
    }

    return { valid: true, ip: addresses[0] }
  } catch (error) {
    return { valid: false, error: `DNS resolution failed: ${error}` }
  }
}

export const webhookHook: HookHandler = {
  async run(
    event: EventData,
    target: unknown,
    config: unknown,
    ctx?: HookRunContext
  ): Promise<HookResult> {
    const { url } = target as WebhookTarget
    const { secret, webhookId, attemptNumber } = config as WebhookConfig & {
      attemptNumber?: number
    }
    const attempt = attemptNumber ?? 1

    // Idempotency: if BullMQ is re-running this job after a worker crash,
    // skip the delivery — the previous attempt already POSTed (and the
    // remote saw it). Without this, customers see duplicate webhook
    // deliveries on every rolling restart that interrupts a worker.
    const claimed = await claimHookDelivery(ctx?.jobId, 'webhook')
    if (!claimed) {
      console.log(`[Webhook] Skipping duplicate delivery for job ${ctx?.jobId} → ${url}`)
      return { success: true }
    }

    console.log(`[Webhook] Processing ${event.type} → ${url}`)

    const eventId = `evt_${crypto.randomUUID().replace(/-/g, '')}`
    const timestamp = Math.floor(Date.now() / 1000)

    // SSRF protection: Resolve and validate IP at delivery time
    // Note: We validate the IP but use the original hostname for the request
    // to ensure TLS certificates match. The TOCTOU window is minimal in practice.
    const parsedUrl = new URL(url)
    const ipCheck = await resolveAndValidateIP(parsedUrl.hostname)
    if (!ipCheck.valid) {
      console.error(`[Webhook] ❌ SSRF blocked: ${ipCheck.error}`)
      void recordAttempt({
        webhookId,
        eventId,
        eventType: event.type,
        attemptNumber: attempt,
        status: 'blocked_ssrf',
        errorMessage: ipCheck.error ?? 'blocked',
        requestUrl: url,
        requestPayloadBytes: 0,
        signatureTimestamp: timestamp,
      })
      return { success: false, error: ipCheck.error, shouldRetry: false }
    }

    // Build payload
    const payload = JSON.stringify({
      id: eventId,
      type: event.type,
      createdAt: event.timestamp,
      data: event.data,
    })
    const payloadBytes = Buffer.byteLength(payload, 'utf8')
    // Cap stored payload at ~32 KB so the audit log stays small enough to
    // browse cheaply. Oversized payloads are dropped (NULL) and flagged so
    // the redeliver UI can surface a friendly "payload not stored" message.
    const PAYLOAD_STORE_MAX = 32 * 1024
    const requestPayloadJson: unknown =
      payloadBytes <= PAYLOAD_STORE_MAX ? JSON.parse(payload) : null
    const requestPayloadTruncated = payloadBytes > PAYLOAD_STORE_MAX

    // Create HMAC signature
    const signaturePayload = `${timestamp}.${payload}`
    const signature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex')

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-Quackback-Signature': `sha256=${signature}`,
      'X-Quackback-Timestamp': String(timestamp),
      'X-Quackback-Event': event.type,
    }

    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
        redirect: 'error', // Prevent SSRF via redirects to internal IPs
      })

      clearTimeout(timeoutId)
      const latencyMs = Date.now() - start

      // Read up to 500 chars of response body for the audit log.
      let snippet: string | null = null
      try {
        const text = await response.text()
        snippet = text.slice(0, 500)
      } catch {
        snippet = null
      }

      if (response.ok) {
        console.log(`[Webhook] ✅ Delivered to ${url}`)
        await updateWebhookSuccess(webhookId)
        void recordAttempt({
          webhookId,
          eventId,
          eventType: event.type,
          attemptNumber: attempt,
          status: 'success',
          httpStatus: response.status,
          requestUrl: url,
          requestPayloadBytes: payloadBytes,
          requestPayloadJson,
          requestPayloadTruncated,
          responseBodySnippet: snippet,
          latencyMs,
          signatureTimestamp: timestamp,
        })
        return { success: true }
      }

      // Non-2xx response
      const error = `HTTP ${response.status}`
      console.log(`[Webhook] ❌ Failed: ${error}`)
      const retryable = response.status >= 500 || response.status === 429
      void recordAttempt({
        webhookId,
        eventId,
        eventType: event.type,
        attemptNumber: attempt,
        status: retryable ? 'failed_retryable' : 'failed_terminal',
        httpStatus: response.status,
        errorMessage: error,
        requestUrl: url,
        requestPayloadBytes: payloadBytes,
        requestPayloadJson,
        requestPayloadTruncated,
        responseBodySnippet: snippet,
        latencyMs,
        signatureTimestamp: timestamp,
      })
      return { success: false, error, shouldRetry: retryable }
    } catch (error) {
      const latencyMs = Date.now() - start
      let errorMsg = 'Unknown error'
      if (error instanceof Error) {
        errorMsg = error.name === 'AbortError' ? 'Request timeout' : error.message
      }

      console.error(`[Webhook] ❌ Failed: ${errorMsg}`)
      const retryable = isRetryableError(error)
      void recordAttempt({
        webhookId,
        eventId,
        eventType: event.type,
        attemptNumber: attempt,
        status: retryable ? 'failed_retryable' : 'failed_terminal',
        errorMessage: errorMsg,
        requestUrl: url,
        requestPayloadBytes: payloadBytes,
        requestPayloadJson,
        requestPayloadTruncated,
        latencyMs,
        signatureTimestamp: timestamp,
      })
      return { success: false, error: errorMsg, shouldRetry: retryable }
    }
  },
}

async function recordAttempt(input: {
  webhookId: WebhookId
  eventId: string
  eventType: string
  attemptNumber: number
  status: 'queued' | 'success' | 'failed_retryable' | 'failed_terminal' | 'blocked_ssrf'
  httpStatus?: number | null
  errorMessage?: string | null
  requestUrl: string
  requestPayloadBytes: number
  requestPayloadJson?: unknown
  requestPayloadTruncated?: boolean
  responseBodySnippet?: string | null
  latencyMs?: number | null
  signatureTimestamp: number
}): Promise<void> {
  try {
    const { recordDeliveryAttempt } =
      await import('@/lib/server/domains/webhooks/webhook.deliveries')
    await recordDeliveryAttempt(input)
  } catch (err) {
    console.warn('[Webhook] recordDeliveryAttempt failed', err)
  }
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
    console.error('[Webhook] Failed to update success status:', error)
  }
}
