/**
 * Central inbound webhook orchestrator.
 *
 * Handles incoming webhooks from external platforms (Linear, GitHub, Jira, etc.)
 * by verifying signatures, parsing status changes, and updating post statuses.
 *
 * Loop prevention: outbound issue-tracking hooks only fire for `post.created` events,
 * so the `post.status_changed` event dispatched here won't re-trigger them.
 */

import { db, integrations, postExternalLinks, eq, and } from '@/lib/server/db'
import { getIntegration } from './index'
import { decryptSecrets } from './encryption'
import { resolveStatusMapping, type StatusMappings } from './status-mapping'
import { changeStatus } from '@/lib/server/domains/posts/post.status'
import type { PostId, StatusId, PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'inbound-webhook' })

/**
 * Handle an inbound webhook from an external platform.
 */
export async function handleInboundWebhook(
  request: Request,
  integrationType: string
): Promise<Response> {
  // Block inbound writes when the workspace is suspended / deleting.
  // No-op when settings.state is 'active' (the default with no
  // declarative config file present).
  const { ensureNotSuspended } = await import('@/lib/server/middleware/suspension-guard')
  try {
    await ensureNotSuspended()
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const e = err as { statusCode: number; message: string }
      return new Response(e.message, { status: e.statusCode })
    }
    throw err
  }

  const definition = getIntegration(integrationType)
  if (!definition?.inbound) {
    return new Response('Unknown integration type', { status: 404 })
  }

  // Read raw body (needed for HMAC verification)
  const body = await request.text()

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
    return new Response('OK', { status: 200 })
  }

  // Resolve status mapping
  const statusMappings = config.statusMappings as StatusMappings | undefined
  const statusId = resolveStatusMapping(result.externalStatus, statusMappings)
  if (!statusId) {
    log.debug(
      { integration_type: integrationType, external_status: result.externalStatus },
      'no status mapping, ignoring'
    )
    return new Response('OK', { status: 200 })
  }

  // Update the post status using the integration's service principal
  try {
    if (!integration.principalId) {
      log.error(
        { integration_type: integrationType },
        'integration has no service principal, skipping status update'
      )
      return new Response('OK', { status: 200 })
    }

    await changeStatus(link.postId as PostId, statusId as StatusId, {
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

  return new Response('OK', { status: 200 })
}
