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
import { resolveStatusMapping, type StatusMappings } from './status-mapping'
import { changeStatus } from '@/lib/server/domains/posts/post.status'
import type { PostId, StatusId, PrincipalId } from '@quackback/ids'

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
    console.error(`[Inbound] No webhook secret for ${integrationType}`)
    return new Response('Webhook not configured', { status: 404 })
  }

  // Verify signature — may return a Response for handshake/challenge or auth failure
  const verification = await definition.inbound.verifySignature(request, body, webhookSecret)
  if (verification !== true) {
    return verification
  }

  // Parse the webhook payload for a status change
  const result = await definition.inbound.parseStatusChange(body, config)
  if (!result) {
    // Not a status change event — acknowledge but ignore
    return new Response('OK', { status: 200 })
  }

  console.log(
    `[Inbound] ${integrationType} ${result.eventType}: externalId=${result.externalId} → status="${result.externalStatus}"`
  )

  // Reverse lookup: find the post linked to this external ID
  const link = await db.query.postExternalLinks.findFirst({
    where: and(
      eq(postExternalLinks.integrationType, integrationType),
      eq(postExternalLinks.externalId, result.externalId)
    ),
  })
  if (!link) {
    console.log(`[Inbound] No linked post for ${integrationType}:${result.externalId}, ignoring`)
    return new Response('OK', { status: 200 })
  }

  // Resolve status mapping
  const statusMappings = config.statusMappings as StatusMappings | undefined
  const statusId = resolveStatusMapping(result.externalStatus, statusMappings)
  if (!statusId) {
    console.log(
      `[Inbound] No status mapping for "${result.externalStatus}" in ${integrationType}, ignoring`
    )
    return new Response('OK', { status: 200 })
  }

  // Update the post status using the integration's service principal
  try {
    if (!integration.principalId) {
      console.error(
        `[Inbound] Integration ${integrationType} has no service principal, skipping status update`
      )
      return new Response('OK', { status: 200 })
    }

    await changeStatus(link.postId as PostId, statusId as StatusId, {
      principalId: integration.principalId as PrincipalId,
      displayName: `${integrationType} Integration`,
    })
    console.log(
      `[Inbound] Updated post ${link.postId} status to ${statusId} via ${integrationType}`
    )
  } catch (error) {
    console.error(`[Inbound] Failed to update post status:`, error)
    // Still return 200 to prevent the platform from retrying
  }

  return new Response('OK', { status: 200 })
}
