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
import {
  db,
  integrations,
  postActivity,
  postExternalLinks,
  ticketExternalLinks,
  tickets,
  eq,
  and,
  inArray,
  isNull,
  sql,
} from '@/lib/server/db'
import { getIntegration } from './index'
import { decryptSecrets } from './encryption'
import {
  resolveStatusMapping,
  resolveTicketStatusMapping,
  type StatusMappings,
} from './status-mapping'
import { changeStatus } from '@/lib/server/domains/posts/post.status'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { readTextBodyOr413, MAX_WEBHOOK_BODY_BYTES } from '@/lib/server/utils/read-body'
import type { PostId, PostStatusId, PrincipalId, TicketId } from '@quackback/ids'
import type { InboundWebhookResult } from './inbound-types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'inbound-webhook' })

type IntegrationRow = typeof integrations.$inferSelect

/** Provider display name for note/activity copy ("GitHub", "Jira"), falling
 *  back to the raw type for a provider missing from the registry. */
function providerName(integrationType: string): string {
  return getIntegration(integrationType)?.catalog.name ?? integrationType
}

/** Human verb for the external move — provider-stated transition when known,
 *  otherwise the new status name (see InboundWebhookResult.transition). */
function externalMoveVerb(result: InboundWebhookResult): string {
  if (result.transition === 'closed') return 'was closed'
  if (result.transition === 'reopened') return 'was reopened'
  return `moved to "${result.externalStatus}"`
}

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

  // Decrypt secrets so handlers can access OAuth tokens
  const secrets = integration.secrets ? decryptSecrets(integration.secrets) : {}

  // Parse the webhook payload for a status change
  const result = await definition.inbound.parseStatusChange(body, config, secrets)
  if (!result) {
    // Not a status change event — acknowledge but ignore
    return new Response('OK', { status: 200 })
  }

  log.info(
    {
      integration_type: integrationType,
      event_type: result.eventType,
      external_id: result.externalId,
      external_status: result.externalStatus,
    },
    'inbound status change received'
  )

  // A single external ID can be linked to a post, to tickets, or both — the
  // two branches are independent, and each failure is swallowed here so one
  // branch's error can't starve the other or 500 the platform into
  // redelivering a half-applied webhook.
  const deliveryKey = inboundDeliveryKey(integrationType, body)
  try {
    await applyPostStatusChange(integration, integrationType, config, result, deliveryKey)
  } catch (error) {
    log.error({ err: error, integration_type: integrationType }, 'inbound post branch failed')
  }
  try {
    await applyTicketStatusChange(integration, integrationType, config, result, deliveryKey)
  } catch (error) {
    log.error({ err: error, integration_type: integrationType }, 'inbound ticket branch failed')
  }

  return new Response('OK', { status: 200 })
}

/**
 * Post branch: reverse-look-up post_external_links by external ID and apply
 * the config.statusMappings-resolved status via the post domain.
 */
async function applyPostStatusChange(
  integration: IntegrationRow,
  integrationType: string,
  config: Record<string, unknown>,
  result: InboundWebhookResult,
  deliveryKey: string
): Promise<void> {
  // Reverse lookup: find the post linked to this external ID
  const link = await db.query.postExternalLinks.findFirst({
    where: and(
      eq(postExternalLinks.integrationType, integrationType),
      eq(postExternalLinks.externalId, result.externalId)
    ),
  })
  if (!link) {
    log.debug(
      { integration_type: integrationType, external_id: result.externalId },
      'no linked post for external id, ignoring'
    )
    return
  }

  // Record the external move on the post's activity timeline BEFORE mapping
  // resolution: an unmapped (or same-status) move is still a real signal on a
  // linked issue. A redelivered webhook is skipped via the stamped delivery
  // key (no unique index here — an existence probe is enough for a
  // fire-and-forget timeline entry). createActivity itself never throws.
  const [existing] = await db
    .select({ id: postActivity.id })
    .from(postActivity)
    .where(
      and(
        eq(postActivity.postId, link.postId),
        sql`${postActivity.metadata} ->> 'inboundDeliveryKey' = ${deliveryKey}`
      )
    )
    .limit(1)
  if (!existing) {
    const { createActivity } = await import('@/lib/server/domains/activity/activity.service')
    createActivity({
      postId: link.postId as PostId,
      principalId: (integration.principalId as PrincipalId | null) ?? null,
      type: 'external.status_changed',
      metadata: {
        integrationType,
        externalDisplayId: link.externalDisplayId ?? null,
        externalUrl: link.externalUrl ?? null,
        externalStatus: result.externalStatus,
        transition: result.transition ?? null,
        inboundDeliveryKey: deliveryKey,
      },
    })
  }

  // Resolve status mapping
  const statusMappings = config.statusMappings as StatusMappings | undefined
  const statusId = resolveStatusMapping(result.externalStatus, statusMappings)
  if (!statusId) {
    log.debug(
      { integration_type: integrationType, external_status: result.externalStatus },
      'no status mapping, ignoring'
    )
    return
  }

  // Update the post status using the integration's service principal
  try {
    if (!integration.principalId) {
      log.error(
        { integration_type: integrationType },
        'integration has no service principal, skipping status update'
      )
      return
    }

    await changeStatus(link.postId as PostId, statusId as PostStatusId, {
      principalId: integration.principalId as PrincipalId,
      displayName: `${integrationType} Integration`,
    })
    log.info(
      { post_id: link.postId, status_id: statusId, integration_type: integrationType },
      'inbound status update applied'
    )
  } catch (error) {
    log.error({ err: error, integration_type: integrationType }, 'inbound status update failed')
    // Still return 200 to prevent the platform from retrying
  }
}

/**
 * Ticket branch: reverse-look-up ticket_external_links by external ID and
 * apply the config.ticketStatusMappings-resolved ticket status through
 * setTicketStatus, so the public-stage system messages, webhooks, and
 * realtime signals all fire exactly as they do for an agent-driven change.
 */
async function applyTicketStatusChange(
  integration: IntegrationRow,
  integrationType: string,
  config: Record<string, unknown>,
  result: InboundWebhookResult,
  deliveryKey: string
): Promise<void> {
  const links = await db
    .select({
      ticketId: ticketExternalLinks.ticketId,
      externalDisplayId: ticketExternalLinks.externalDisplayId,
      externalUrl: ticketExternalLinks.externalUrl,
    })
    .from(ticketExternalLinks)
    .where(
      and(
        eq(ticketExternalLinks.integrationType, integrationType),
        eq(ticketExternalLinks.externalId, result.externalId)
      )
    )
  if (links.length === 0) {
    log.debug(
      { integration_type: integrationType, external_id: result.externalId },
      'no linked ticket for external id, ignoring'
    )
    return
  }

  // Service actor carrying the integration's principal (mirrors the post
  // branch's service-principal attribution) with an explicit capability
  // grant, since a service principal has no role-derived permission set.
  const actor: Actor = {
    principalId: (integration.principalId as PrincipalId | null) ?? null,
    role: null,
    principalType: 'service',
    segmentIds: new Set(),
    permissions: new Set([PERMISSIONS.TICKET_SET_STATUS]),
  }

  // Dynamic imports keep the ticket domain out of this module's static
  // graph (mirrors the fn layer's convention for service imports).
  const { setTicketStatus } = await import('@/lib/server/domains/tickets/ticket.service')
  const { emitTicketSystemMessage } =
    await import('@/lib/server/domains/tickets/ticket-message.service')
  const { emitTicketExternalStatusChanged } =
    await import('@/lib/server/domains/tickets/ticket.webhooks')

  const ticketRows = await db
    .select()
    .from(tickets)
    .where(
      and(
        inArray(
          tickets.id,
          links.map((l) => l.ticketId as TicketId)
        ),
        isNull(tickets.deletedAt)
      )
    )
  const ticketById = new Map(ticketRows.map((t) => [t.id as string, t]))

  // Close the loop BEFORE mapping resolution: the team-only system note and
  // the agent-watcher bell reflect the external fact (the linked issue moved),
  // which is true whether or not a mapping — or any mapping config — exists.
  // Each link is isolated so one ticket's failure can't starve the others.
  // The note insert is the idempotency gate: a redelivered webhook (same
  // delivery key) no-ops the insert, and the bell only fires when the note
  // actually landed.
  const verb = externalMoveVerb(result)
  for (const link of links) {
    const ticket = ticketById.get(link.ticketId as string)
    if (!ticket) continue
    const reference = link.externalDisplayId ?? `#${result.externalId}`
    let noted = false
    try {
      noted = await emitTicketSystemMessage(
        ticket.id as TicketId,
        'external_status_changed',
        `${providerName(integrationType)} issue ${reference} ${verb}`,
        {
          metadata: {
            externalReference: reference,
            externalUrl: link.externalUrl ?? undefined,
            externalStatus: result.externalStatus,
            transition: result.transition ?? undefined,
          },
          dedupeKey: deliveryKey,
        }
      )
    } catch (error) {
      log.error(
        { err: error, ticket_id: link.ticketId, integration_type: integrationType },
        'inbound external-status system note failed'
      )
    }
    if (!noted) continue
    // Already safe-wrapped internally — a dispatch failure only logs.
    await emitTicketExternalStatusChanged(actor, ticket, {
      integrationType,
      externalDisplayId: link.externalDisplayId ?? null,
      externalUrl: link.externalUrl ?? null,
      externalStatus: result.externalStatus,
      transition: result.transition ?? null,
    })
  }

  const ticketStatusMappings = config.ticketStatusMappings as StatusMappings | undefined
  const statusId = resolveTicketStatusMapping(result.externalStatus, ticketStatusMappings)
  if (!statusId) {
    log.debug(
      { integration_type: integrationType, external_status: result.externalStatus },
      'no ticket status mapping, ignoring'
    )
    return
  }

  for (const link of links) {
    try {
      await setTicketStatus(link.ticketId as TicketId, statusId, actor)
      log.info(
        { ticket_id: link.ticketId, status_id: statusId, integration_type: integrationType },
        'inbound ticket status update applied'
      )
    } catch (error) {
      log.error(
        { err: error, ticket_id: link.ticketId, integration_type: integrationType },
        'inbound ticket status update failed'
      )
      // Still return 200 to prevent the platform from retrying
    }
  }
}
