/**
 * Central inbound webhook orchestrator.
 *
 * Handles incoming webhooks from external platforms (Linear, GitHub, Jira, etc.)
 * by verifying signatures, parsing status changes, and updating post statuses.
 *
 * Loop prevention: outbound issue-tracking hooks only fire for `post.created` events,
 * so the `post.status_changed` event dispatched here won't re-trigger them.
 */

import { createHash } from 'crypto'
import { db, integrations, eq, and } from '@/lib/server/db'
import { getIntegration } from './index'
import { readTextBodyOr413, MAX_WEBHOOK_BODY_BYTES } from '@/lib/server/utils/read-body'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'inbound-webhook' })

/**
 * Per-delivery idempotency key for the close-the-loop side effects (note,
 * bell, post activity). Providers redeliver webhooks (retry-after-timeout,
 * at-least-once), and a redelivered request carries a byte-identical body —
 * while a genuinely new event (even close→reopen→close on the same issue)
 * differs in payload timestamps/ids. Hashing the raw body therefore dedupes
 * exactly the redelivery case without suppressing real repeats, and needs no
 * per-provider delivery-id header knowledge.
 */
function inboundDeliveryKey(integrationType: string, body: string): string {
  return createHash('sha256').update(`${integrationType}:${body}`).digest('hex')
}

/**
 * Handle an inbound webhook from an external platform.
 */
export async function handleInboundWebhook(
  request: Request,
  integrationType: string
): Promise<Response> {
  const definition = getIntegration(integrationType)
  if (!definition?.inbound) {
    return new Response('Unknown integration type', { status: 404 })
  }

  // Read raw body through the bounded reader (needed for HMAC verification)
  const body = await readTextBodyOr413(request, MAX_WEBHOOK_BODY_BYTES)
  if (body instanceof Response) return body

  // Get integration record
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.integrationType, integrationType),
      eq(integrations.status, 'active')
    ),
  })
  if (!integration) {
    return new Response('Integration not configured', { status: 404 })
  }

  const handshake = definition.inbound.handshake?.(request)
  if (handshake) return handshake

  const config = (integration.config ?? {}) as Record<string, unknown>
  const webhookSecret = config.webhookSecret as string | undefined
  if (!webhookSecret) {
    log.error({ integration_type: integrationType }, 'inbound webhook secret not configured')
    return new Response('Webhook not configured', { status: 404 })
  }

  // Verify signature — may return a Response for handshake/challenge or auth failure
  const verification = await definition.inbound.verifySignature(request, body, webhookSecret)
  if (verification !== true) {
    return verification
  }

  // GitHub inbox channel is a second consumer, isolated from tracker status
  // sync. It must run even when parseStatusChange returns null (comments are
  // not status changes) and must never 500 the webhook.
  if (integrationType === 'github') {
    try {
      const { ingestGitHubChannelEvent } =
        await import('@/lib/server/domains/conversation/conversation.github-inbound')
      await ingestGitHubChannelEvent({
        body,
        eventName: request.headers.get('X-GitHub-Event'),
        integration,
      })
    } catch (error) {
      log.error({ err: error, integration_type: integrationType }, 'inbound github channel failed')
      return new Response('Inbox ingest failed', { status: 500 })
    }
  }

  try {
    const { queueInboundWebhook } = await import('./sync/inbound')
    await queueInboundWebhook(integration, body, inboundDeliveryKey(integrationType, body))
  } catch {
    return new Response('Could not accept status event', { status: 503 })
  }
  return new Response('OK', { status: 200 })
}
