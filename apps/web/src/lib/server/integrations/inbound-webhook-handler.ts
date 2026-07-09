/**
 * Central inbound webhook orchestrator.
 *
 * Handles incoming webhooks from external platforms (Linear, GitHub, Jira, etc.)
 * by verifying signatures, parsing status changes, and updating post statuses.
 *
 * Loop prevention: outbound issue-tracking hooks only fire for `post.created` events,
 * so the `post.status_changed` event dispatched here won't re-trigger them.
 */

import { db, integrations, postExternalLinks, ticketExternalLinks, eq, and } from '@/lib/server/db'
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
  // two branches are independent and each swallows its own failures so the
  // platform never retries a half-applied webhook.
  await applyPostStatusChange(integration, integrationType, config, result)
  await applyTicketStatusChange(integration, integrationType, config, result)

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
  result: InboundWebhookResult
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
  result: InboundWebhookResult
): Promise<void> {
  const links = await db
    .select({ ticketId: ticketExternalLinks.ticketId })
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

  const ticketStatusMappings = config.ticketStatusMappings as StatusMappings | undefined
  const statusId = resolveTicketStatusMapping(result.externalStatus, ticketStatusMappings)
  if (!statusId) {
    log.debug(
      { integration_type: integrationType, external_status: result.externalStatus },
      'no ticket status mapping, ignoring'
    )
    return
  }

  // Dynamic import keeps the ticket domain out of this module's static
  // graph (mirrors the fn layer's convention for service imports).
  const { setTicketStatus } = await import('@/lib/server/domains/tickets/ticket.service')

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
