/**
 * Notification hook handler.
 * Creates in-app notifications for subscribers when events occur.
 *
 * Unlike email hooks (one per subscriber), this handler receives all
 * subscriber IDs at once and batch inserts for efficiency.
 */

import type { HookHandler, HookResult } from '../hook-types'
import type { EventData, EventPostMentionedData } from '../types'
import { createNotificationsBatch } from '@/lib/server/domains/notifications/notification.service'
import type { CreateNotificationInput, NotificationType } from '@/lib/server/domains/notifications'
import type { PrincipalId, PostId, CommentId } from '@quackback/ids'
import { truncate, isRetryableError } from '../hook-utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'notification' })

/**
 * Target for notification hooks - contains all member IDs to notify
 */
export interface NotificationTarget {
  principalIds: PrincipalId[]
}

/**
 * Config for notification hooks - event-specific context
 */
export interface NotificationConfig {
  postId?: PostId
  postTitle?: string
  boardSlug?: string
  postUrl?: string
  commentId?: CommentId
  previousStatus?: string
  newStatus?: string
  commenterName?: string
  commentPreview?: string
  isTeamMember?: boolean
}

export const notificationHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { principalIds } = target as NotificationTarget
    const cfg = config as NotificationConfig

    if (!principalIds || principalIds.length === 0) {
      return { success: true }
    }

    log.debug(
      { event_type: event.type, member_count: principalIds.length },
      'creating notifications'
    )

    try {
      const notifications = buildNotifications(event, principalIds, cfg)

      if (notifications.length === 0) {
        return { success: true }
      }

      const ids = await createNotificationsBatch(notifications)

      log.info({ event_type: event.type, count: ids.length }, 'notifications created')
      return {
        success: true,
        externalId: ids[0], // Return first ID as representative
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error, event_type: event.type }, 'failed to create notifications')
      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}

/**
 * Build notification inputs for all subscribers based on event type
 */
function buildNotifications(
  event: EventData,
  principalIds: PrincipalId[],
  config: NotificationConfig
): CreateNotificationInput[] {
  const { postId, postTitle, boardSlug, postUrl } = config

  if (event.type === 'post.status_changed') {
    const { previousStatus, newStatus } = config
    return principalIds.map((principalId) => ({
      principalId,
      type: 'post_status_changed' as NotificationType,
      title: `Status changed to ${newStatus}`,
      body: `"${postTitle}" moved from ${previousStatus} to ${newStatus}`,
      postId,
      metadata: { postTitle, boardSlug, postUrl, previousStatus, newStatus },
    }))
  }

  if (event.type === 'comment.created') {
    const { commentId, commenterName, commentPreview, isTeamMember } = config
    const title = isTeamMember ? `${commenterName} (team) commented` : `${commenterName} commented`
    // commentPreview is already HTML-stripped and truncated (200 chars) in targets.ts
    const body = truncate(commentPreview ?? '', 150)

    return principalIds.map((principalId) => ({
      principalId,
      type: 'comment_created' as NotificationType,
      title,
      body,
      postId,
      commentId,
      metadata: {
        postTitle,
        boardSlug,
        postUrl,
        commenterName,
        commentPreview,
        isTeamMember,
      },
    }))
  }

  if (event.type === 'changelog.published') {
    const changelogConfig = config as Record<string, unknown>
    const changelogTitle = (changelogConfig.changelogTitle as string) ?? 'New update'
    const body = truncate((changelogConfig.contentPreview as string) ?? '', 150)

    return principalIds.map((principalId) => ({
      principalId,
      type: 'changelog_published' as NotificationType,
      title: `New update: ${changelogTitle}`,
      body,
      metadata: {
        changelogTitle,
        changelogUrl: changelogConfig.changelogUrl,
        contentPreview: changelogConfig.contentPreview,
      },
    }))
  }

  if (event.type === 'post.mentioned') {
    const data = event.data as EventPostMentionedData
    const actorName = event.actor.displayName?.trim() || 'Anonymous user'
    // principalIds is always a single-element array for post.mentioned (target resolver builds it that way).
    return principalIds.map((principalId) => ({
      principalId,
      type: 'post_mentioned' as NotificationType,
      title: `${actorName} mentioned you in a post`,
      body: truncate(data.postTitle, 150),
      postId: data.postId as PostId,
      metadata: { postUrl: data.postUrl, excerpt: data.excerpt },
    }))
  }

  return []
}
