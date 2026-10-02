import { deliveryError } from '@/lib/server/integrations/sync/outcomes'
/**
 * Linear hook handler.
 * Creates Linear issues for new feedback and forwards public comments to the
 * linked issue.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { CommentCreatedEvent, EventData } from '@/lib/server/events/types'
import { buildLinearCommentBody, buildLinearIssueBody } from '@/integrations/linear/server/message'
import { linearIssues } from '@/integrations/linear/server/issues'
import {
  createLinearComment,
  findLinkedLinearIssueId,
  hasPendingLinearIssueCreate,
} from '@/integrations/linear/server/comments'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'linear' })

/** How long to wait before re-checking for an issue whose creation is still in flight. */
const COMMENT_RETRY_DELAY_MS = 30_000

export interface LinearTarget {
  channelId: string // teamId is stored as channelId for consistency
}

export interface LinearConfig {
  accessToken: string
  rootUrl: string
  /** Set by the sync worker; identifies which installation's links to comment on. */
  integrationId?: string
}

/**
 * Mirror a public comment onto the Linear issue linked to its post. The sync
 * ledger already filtered private, unpublished, and deleted comments and owns
 * idempotency, so this only has to find the issue and post the comment.
 */
async function syncComment(
  event: CommentCreatedEvent,
  config: LinearConfig
): Promise<DeliveryOutcome> {
  if (event.data.comment.isPrivate || !config.integrationId) return { state: 'succeeded' }

  const issueId = await findLinkedLinearIssueId(event.data.post.id, config.integrationId)
  if (!issueId) {
    // The issue for a brand-new post may still be queued; retry so the comment
    // lands once it exists instead of being dropped by a race with the create.
    if (await hasPendingLinearIssueCreate(event.data.post.id, config.integrationId)) {
      log.debug({ post_id: event.data.post.id }, 'linked issue not created yet, waiting')
      return { state: 'retry_wait', errorCode: 'unavailable', retryAfterMs: COMMENT_RETRY_DELAY_MS }
    }
    log.debug({ post_id: event.data.post.id }, 'no linked issue for comment, skipping')
    return { state: 'succeeded' }
  }

  try {
    const commentId = await createLinearComment(
      config.accessToken,
      issueId,
      buildLinearCommentBody(event, config.rootUrl)
    )
    log.info({ issue_id: issueId, comment_id: commentId }, 'comment created')
    return { state: 'succeeded', result: { externalId: commentId } }
  } catch (error) {
    return deliveryError(error)
  }
}

export const linearHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: teamId } = target as LinearTarget
    const linearConfig = config as LinearConfig
    const { accessToken, rootUrl } = linearConfig

    if (event.type === 'comment.created') {
      return syncComment(event, linearConfig)
    }

    // Only create issues for new feedback
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    log.debug({ event_type: event.type, team_id: teamId }, 'creating issue')

    const { title, description } = buildLinearIssueBody(event, rootUrl)

    try {
      // The capability owns the GraphQL call + error classification; this
      // hook returns the same explicit delivery outcome as every provider.
      const created = await linearIssues.create!({
        auth: { channelId: teamId, accessToken },
        title,
        bodyMarkdown: description,
      })

      log.info(
        {
          issue_id: created.externalId,
          issue_identifier: created.externalDisplayId,
          team_id: teamId,
        },
        'issue created'
      )
      return {
        state: 'succeeded',
        result: {
          externalId: created.externalId,
          externalDisplayId: created.externalDisplayId ?? undefined,
          externalUrl: created.externalUrl ?? undefined,
        },
      }
    } catch (error) {
      return deliveryError(error)
    }
  },
}
