/**
 * Central inbound webhook orchestrator.
 *
 * Handles incoming webhooks from external platforms (Linear, GitHub, Jira, etc.)
 * by verifying signatures, parsing status changes, and updating post statuses.
 *
 * Loop prevention: what a delivery changes is changed as the integration's
 * service principal, and the integration sink never sends an integration what
 * its own principal did, so a status moved here (or a ticket an issue opened)
 * is not sent back as a new issue or edit. Outbound tracker hooks create
 * issues for `post.created` and, where a destination opts in, for
 * `ticket.created` / `ticket.assigned`; neither fires for the status events
 * dispatched here.
 */

import { createHash } from 'crypto'
import { db, integrations, eq, and } from '@/lib/server/db'
import { getIntegration } from './index'
import { readTextBodyOr413, MAX_WEBHOOK_BODY_BYTES } from '@/lib/server/utils/read-body'
import { logger } from '@/lib/server/logger'
import type { DestinationRef, IntegrationDestination } from './destinations'

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
  let webhookSecret = config.webhookSecret as string | undefined

  // A provider serving several destinations (GitHub repositories) gives each
  // its own webhook and secret. The body names the destination only so the
  // right secret can be picked; an unknown or switched-off destination is
  // refused before verification. A destination whose secret has not yet moved
  // off the connection config verifies with that legacy secret, and so do the
  // connection's default repository (`config.channelId`) while it has no row
  // yet (saved by an app version that predates destinations) and a body that
  // names no repository at all. Once the secret has moved, those find none.
  const multiple = definition.destination?.multiple
  let routed: { destination: IntegrationDestination; ref: DestinationRef } | null = null
  if (multiple && definition.inbound.destinationOf) {
    const { findInboundDestination, readDestinationSecret } = await import('./destinations')
    const ref = definition.inbound.destinationOf(body, request.headers)
    const destination = ref
      ? await findInboundDestination(integration.id, multiple.kind, ref)
      : null
    const legacyFallback =
      !ref ||
      (!destination &&
        typeof config.channelId === 'string' &&
        config.channelId.toLowerCase() === ref.externalId.toLowerCase())
    if (ref && destination?.enabled) {
      routed = { destination, ref }
      webhookSecret = readDestinationSecret(destination) ?? webhookSecret
    } else if (!legacyFallback) {
      log.warn(
        { integration_type: integrationType, destination: ref?.externalId ?? null },
        'inbound webhook for an unconfigured destination'
      )
      return new Response('Webhook not configured', { status: 404 })
    }
  }

  if (!webhookSecret) {
    log.error({ integration_type: integrationType }, 'inbound webhook secret not configured')
    return new Response('Webhook not configured', { status: 404 })
  }

  // Verify signature — may return a Response for handshake/challenge or auth failure
  const verification = await definition.inbound.verifySignature(request, body, webhookSecret)
  if (verification !== true) {
    return verification
  }

  if (routed) {
    const { markDestinationInbound, destinationReceives } = await import('./destinations')
    await markDestinationInbound(integration, routed.destination, routed.ref).catch((err) =>
      log.warn({ err, integration_type: integrationType }, 'destination inbound stamp failed')
    )
    // An outbound-only repository's deliveries are acknowledged and dropped:
    // no status sync, no inbox conversation.
    if (!destinationReceives(routed.destination)) return new Response('OK', { status: 200 })
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
        destination: routed?.destination,
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
