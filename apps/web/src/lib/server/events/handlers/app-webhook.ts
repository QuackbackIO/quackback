/**
 * App-webhook delivery hook (EVENTING-V2 WO-13). Signed HTTP delivery to a
 * third-party app's endpoint, mirroring the customer-webhook hook: HMAC-SHA256
 * over `${timestamp}.${payload}`, X-Quackback-* headers, safeFetch (SSRF
 * chokepoint), and hook_deliveries idempotency. The app's signing secret lives
 * in apps.webhook_secret_enc (encrypted via integrations/encryption) and is
 * decrypted just-in-time here — it never travels in the BullMQ job payload.
 */
import crypto from 'crypto'
import type { HookHandler, HookResult, HookRunContext } from '../hook-types'
import type { EventData } from '../types'
import { safeFetch, SsrfError, TimeoutError } from '@/lib/server/content/ssrf-guard'
import { isRetryableError } from '../hook-utils'
import {
  claimHookDelivery,
  completeHookDelivery,
  failHookDelivery,
  releaseHookDelivery,
} from '../hook-idempotency'
import { db, apps, oauthClient, and, eq } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { logger } from '@/lib/server/logger'
import { getEventDefinition } from '../catalogue'
import { appMatches } from '../resolvers/app-webhook.resolver'

const log = logger.child({ component: 'app-webhook' })
const TIMEOUT_MS = 5_000
const USER_AGENT = 'Quackback-Webhook/1.0 (+https://quackback.io)'

interface AppWebhookConfig {
  appId: string
}

export const appWebhookHook: HookHandler = {
  async run(
    event: EventData,
    _target: unknown,
    config: unknown,
    ctx?: HookRunContext
  ): Promise<HookResult> {
    const { appId } = config as AppWebhookConfig

    const claimed = await claimHookDelivery(ctx?.jobId, 'app_webhook')
    if (!claimed) return { success: true }

    // Delivery-time re-validation: the enqueue-time snapshot (including the
    // queued target URL) is superseded by the live row, so a revocation,
    // subscription change, or endpoint change between enqueue and delivery is
    // honored. The WHERE excludes disabled OAuth clients; appMatches is the
    // same subscription+scope gate the resolver applies.
    let secret: string
    let url: string
    try {
      const [row] = await db
        .select({
          webhookSecretEnc: apps.webhookSecretEnc,
          webhookEndpoint: apps.webhookEndpoint,
          subscribedEventTypes: apps.subscribedEventTypes,
          grantedScopes: apps.grantedScopes,
          status: apps.status,
        })
        .from(apps)
        .innerJoin(oauthClient, eq(apps.oauthClientId, oauthClient.clientId))
        .where(and(eq(apps.id, appId), eq(oauthClient.disabled, false)))
        .limit(1)
      const requiredScope = getEventDefinition(event.type)?.requiredScope
      if (!row || !row.webhookSecretEnc || !appMatches(row, event.type, requiredScope)) {
        await failHookDelivery(ctx?.jobId)
        return { success: false, error: 'App not deliverable', shouldRetry: false }
      }
      secret = decryptSecrets<{ secret: string }>(row.webhookSecretEnc).secret
      url = row.webhookEndpoint!
    } catch (error) {
      log.error({ err: error, app_id: appId }, 'failed to load app webhook secret')
      await releaseHookDelivery(ctx?.jobId)
      return { success: false, error: 'Failed to load app secret', shouldRetry: true }
    }

    const payload = JSON.stringify({
      id: event.id,
      type: event.type,
      createdAt: event.timestamp,
      data: event.data,
    })
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex')

    try {
      const response = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'X-Quackback-Signature': `sha256=${signature}`,
          'X-Quackback-Timestamp': String(timestamp),
          'X-Quackback-Event': event.type,
        },
        body: payload,
        timeoutMs: TIMEOUT_MS,
      })

      if (response.ok) {
        await completeHookDelivery(ctx?.jobId)
        return { success: true }
      }
      const retryable = response.status >= 500 || response.status === 429
      if (retryable) await releaseHookDelivery(ctx?.jobId)
      else await failHookDelivery(ctx?.jobId)
      return { success: false, error: `HTTP ${response.status}`, shouldRetry: retryable }
    } catch (error) {
      if (error instanceof SsrfError) {
        await failHookDelivery(ctx?.jobId)
        return { success: false, error: error.message, shouldRetry: false }
      }
      if (error instanceof TimeoutError) {
        await releaseHookDelivery(ctx?.jobId)
        return { success: false, error: 'Request timeout', shouldRetry: true }
      }
      const retryable = isRetryableError(error)
      if (retryable) await releaseHookDelivery(ctx?.jobId)
      else await failHookDelivery(ctx?.jobId)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        shouldRetry: retryable,
      }
    }
  },
}
