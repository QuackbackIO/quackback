/**
 * Notification hook handler.
 * Creates in-app notifications for subscribers when events occur.
 *
 * Unlike email hooks (one per subscriber), this handler receives all
 * subscriber IDs at once and batch inserts for efficiency.
 */

import type { HookHandler, HookResult } from '../hook-types'
import type { EventData } from '../types'
import { createNotificationsBatch } from '@/lib/server/domains/notifications'
import type { CreateNotificationInput, NotificationType } from '@/lib/server/domains/notifications'
import type { PrincipalId, PostId, CommentId } from '@quackback/ids'
import { truncate, isRetryableError } from '../hook-utils'

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

    console.log(
      `[Notification] Creating ${event.type} notifications for ${principalIds.length} members`
    )

    try {
      const notifications = buildNotifications(event, principalIds, cfg)

      if (notifications.length === 0) {
        return { success: true }
      }

      const ids = await createNotificationsBatch(notifications)

      console.log(`[Notification] ✅ Created ${ids.length} notifications`)
      return {
        success: true,
        externalId: ids[0], // Return first ID as representative
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Notification] ❌ Failed: ${errorMsg}`)
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

  return []
}
