/**
 * Notification hook handler.
 * Creates in-app notifications for subscribers when events occur.
 *
 * Unlike email hooks (one per subscriber), this handler receives all
 * subscriber IDs at once and batch inserts for efficiency.
 */

import type { HookHandler, HookResult } from '../types'
import type { EventData } from '@/lib/events/types'
import { createNotificationsBatch } from '@/lib/notifications'
import type { CreateNotificationInput, NotificationType } from '@/lib/notifications'
import type { MemberId, PostId, CommentId } from '@quackback/ids'
import { stripHtml, truncate, getRootUrl } from '../utils'

/**
 * Target for notification hooks - contains all member IDs to notify
 */
export interface NotificationTarget {
  memberIds: MemberId[]
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
    const { memberIds } = target as NotificationTarget
    const cfg = config as NotificationConfig

    if (!memberIds || memberIds.length === 0) {
      return { success: true }
    }

    console.log(
      `[Notification] Creating ${event.type} notifications for ${memberIds.length} members`
    )

    try {
      const notifications = buildNotifications(event, memberIds, cfg)

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
        shouldRetry: error instanceof Error && /database|connection/i.test(error.message),
      }
    }
  },
}

/**
 * Build notification inputs for all subscribers based on event type
 */
function buildNotifications(
  event: EventData,
  memberIds: MemberId[],
  config: NotificationConfig
): CreateNotificationInput[] {
  const { postId, postTitle, boardSlug } = config
  const postUrl = `${getRootUrl()}/b/${boardSlug}/posts/${postId}`

  if (event.type === 'post.status_changed') {
    const { previousStatus, newStatus } = config
    return memberIds.map((memberId) => ({
      memberId,
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
    const cleanPreview = truncate(stripHtml(commentPreview ?? ''), 150)

    return memberIds.map((memberId) => ({
      memberId,
      type: 'comment_created' as NotificationType,
      title,
      body: cleanPreview,
      postId,
      commentId,
      metadata: {
        postTitle,
        boardSlug,
        postUrl,
        commenterName,
        commentPreview: truncate(stripHtml(commentPreview ?? ''), 200),
        isTeamMember,
      },
    }))
  }

  return []
}
