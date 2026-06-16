/**
 * Central inbound webhook orchestrator.
 *
 * Handles incoming webhooks from external platforms (Linear, GitHub, Jira, etc.)
 * by verifying signatures, parsing status changes, and updating post statuses.
 *
 * GitHub has a dedicated multi-integration path that matches webhooks to specific
 * integrations by repository name, supporting multiple repos per workspace.
 *
 * Loop prevention:
 *   - Post path: outbound hooks only fire for `post.created`, so `post.status_changed`
 *     dispatched here won't re-trigger them.
 *   - Ticket path: events carry `syncSourceIntegrationId` which outbound targets skip.
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

  // GitHub: multi-integration path — match by repository in the payload
  if (integrationType === 'github') {
    return handleGitHubInboundWebhook(request, body, definition)
  }

  // Default path: single integration per type (Slack, Linear, Jira, etc.)
  return handleSingleIntegrationWebhook(request, body, integrationType, definition)
}

// ============================================================================
// GitHub multi-integration path
// ============================================================================

async function handleGitHubInboundWebhook(
  request: Request,
  body: string,
  definition: ReturnType<typeof getIntegration>
): Promise<Response> {
  // Parse payload to extract repository
  let payload: { repository?: { full_name?: string }; action?: string; issue?: unknown }
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const repoFullName = payload.repository?.full_name
  if (!repoFullName) {
    return new Response('Missing repository in payload', { status: 400 })
  }

  // Find ALL active GitHub integrations
  const allGithub = await db.query.integrations.findMany({
    where: and(eq(integrations.integrationType, 'github'), eq(integrations.status, 'active')),
  })
  if (allGithub.length === 0) {
    return new Response('Integration not configured', { status: 404 })
  }

  // Match by config.channelId (== owner/repo)
  const matched = allGithub.find((int) => {
    const config = (int.config ?? {}) as Record<string, unknown>
    return config.channelId === repoFullName
  })
  if (!matched) {
    console.log(`[Inbound] No GitHub integration for repo ${repoFullName}, ignoring`)
    return new Response('OK', { status: 200 })
  }

  const config = (matched.config ?? {}) as Record<string, unknown>
  const webhookSecret = config.webhookSecret as string | undefined
  if (!webhookSecret) {
    console.error(`[Inbound] No webhook secret for GitHub integration ${matched.id}`)
    return new Response('Webhook not configured', { status: 404 })
  }

  // Verify HMAC signature against the matched integration's secret
  const { verifyGitHubSignature } = await import('./github/inbound')
  const signatureHeader = request.headers.get('X-Hub-Signature-256')
  if (!verifyGitHubSignature(signatureHeader, body, webhookSecret)) {
    return new Response(signatureHeader ? 'Invalid signature' : 'Missing signature', {
      status: 401,
    })
  }

  const githubEvent = request.headers.get('X-GitHub-Event') ?? ''
  let ticketHandlerError: unknown

  // Try ticket path first for issue metadata events.
  // A GitHub issue can also be linked to a feedback post, so don't let ticket
  // sync short-circuit the legacy post status mapping below for `issues`.
  if (githubEvent === 'issues' && payload.issue) {
    try {
      const { handleGitHubTicketEvent } = await import('./github/ticket-inbound')
      await handleGitHubTicketEvent(
        payload as import('./github/ticket-inbound').GitHubIssuePayload,
        {
          id: matched.id,
          principalId: matched.principalId,
          config: config as unknown as import('./github/types').GitHubIntegrationConfig,
        }
      )
    } catch (error) {
      console.error('[Inbound] GitHub ticket handler error:', error)
      ticketHandlerError = error
    }
  }

  if (githubEvent === 'issue_comment' && payload.issue) {
    try {
      const { handleGitHubIssueCommentEvent } = await import('./github/ticket-inbound')
      await handleGitHubIssueCommentEvent(
        payload as import('./github/ticket-inbound').GitHubIssueCommentPayload,
        {
          id: matched.id,
          principalId: matched.principalId,
          config: config as unknown as import('./github/types').GitHubIntegrationConfig,
        }
      )
    } catch (error) {
      console.error('[Inbound] GitHub issue_comment handler error:', error)
      return new Response('GitHub ticket comment sync failed', { status: 500 })
    }
    return new Response('OK', { status: 200 })
  }

  // Fall through to existing post status sync path
  const secrets = matched.secrets ? decryptSecrets(matched.secrets) : {}
  const result = await definition!.inbound!.parseStatusChange(body, config, secrets)
  if (!result) {
    if (ticketHandlerError) {
      return new Response('GitHub ticket sync failed', { status: 500 })
    }
    return new Response('OK', { status: 200 })
  }

  return handlePostStatusUpdate(result, matched, config)
}

// ============================================================================
// Default single-integration path (non-GitHub)
// ============================================================================

async function handleSingleIntegrationWebhook(
  request: Request,
  body: string,
  integrationType: string,
  definition: NonNullable<ReturnType<typeof getIntegration>>
): Promise<Response> {
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

  // Verify signature
  const verification = await definition.inbound!.verifySignature(request, body, webhookSecret)
  if (verification !== true) {
    return verification
  }

  // Decrypt secrets so handlers can access OAuth tokens
  const secrets = integration.secrets ? decryptSecrets(integration.secrets) : {}

  // Parse the webhook payload for a status change
  const result = await definition.inbound!.parseStatusChange(body, config, secrets)
  if (!result) {
    return new Response('OK', { status: 200 })
  }

  return handlePostStatusUpdate(result, integration, config)
}

// ============================================================================
// Shared: post status update
// ============================================================================

async function handlePostStatusUpdate(
  result: { externalId: string; externalStatus: string; eventType: string },
  integration: { id: string; principalId: string | null; integrationType: string },
  config: Record<string, unknown>
): Promise<Response> {
  log.info(
    {
      integration_type: integration.integrationType,
      event_type: result.eventType,
      external_id: result.externalId,
      external_status: result.externalStatus,
    },
    'inbound status change received'
  )

  // Reverse lookup: find the post linked to this external ID
  const link = await db.query.postExternalLinks.findFirst({
    where: and(
      eq(postExternalLinks.integrationType, integration.integrationType),
      eq(postExternalLinks.externalId, result.externalId)
    ),
  })
  if (!link) {
    console.log(
      `[Inbound] No linked post for ${integration.integrationType}:${result.externalId}, ignoring`
    )
    return new Response('OK', { status: 200 })
  }

  // Resolve status mapping
  const statusMappings = config.statusMappings as StatusMappings | undefined
  const statusId = resolveStatusMapping(result.externalStatus, statusMappings)
  if (!statusId) {
    console.log(
      `[Inbound] No status mapping for "${result.externalStatus}" in ${integration.integrationType}, ignoring`
    )
    return new Response('OK', { status: 200 })
  }

  // Update the post status using the integration's service principal
  try {
    if (!integration.principalId) {
      console.error(
        `[Inbound] Integration ${integration.integrationType} has no service principal, skipping status update`
      )
      return new Response('OK', { status: 200 })
    }

    await changeStatus(link.postId as PostId, statusId as StatusId, {
      principalId: integration.principalId as PrincipalId,
      displayName: `${integration.integrationType} Integration`,
    })
    console.log(
      `[Inbound] Updated post ${link.postId} status to ${statusId} via ${integration.integrationType}`
    )
  } catch (error) {
    log.error(
      { err: error, integration_type: integration.integrationType },
      'inbound status update failed'
    )
    // Still return 200 to prevent the platform from retrying
  }

  return new Response('OK', { status: 200 })
}
