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
import type { PrincipalId, PostId, PostCommentId, ConversationMessageId } from '@quackback/ids'
import { truncate, isRetryableError } from '../hook-utils'
import { logger } from '@/lib/server/logger'
import {
  batchGetNotificationPreferences,
  type NotificationPreferencesData,
} from '@/lib/server/domains/subscriptions/subscription.service'
import { shouldNotify } from '@/lib/server/domains/subscriptions/notification-matrix'

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
  commentId?: PostCommentId
  previousStatus?: string
  newStatus?: string
  commenterName?: string
  commentPreview?: string
  isTeamMember?: boolean
  // conversation.assigned (WO-3 slice 1)
  conversationId?: string
  assignedAgentPrincipalId?: string | null
  // ticket.assigned (WO-3 slice 1) — assignedPrincipalId is the direct
  // assignee; any other recipient in the target is a team member.
  ticketId?: string
  assignedPrincipalId?: string | null
  // assistant.handed_off (WO-3 slice 1)
  reason?: string
  // conversation.note_mentioned (WO-3 slice 3)
  conversationMessageId?: string
  authorName?: string
  preview?: string
  // ticket.status_changed (WO-3 slice 4) — labels resolved by the target
  // resolver (getTicketStatusChangedTargets), never carried on the event
  // payload itself.
  title?: string
  stageLabel?: string
  previousStageLabel?: string | null
  // ticket.status_changed + ticket.replied (watchers): lets buildNotifications
  // mark the requester's row portal-audience and everyone else's admin.
  requesterPrincipalId?: string | null
  // message.created (WO-3 slice 5) — read back out by the anti-spam presence
  // gate in run(), below.
  isFirstMessage?: boolean
  // ticket.external_status_changed — the link row's display reference plus the
  // provider's status/transition, resolved by getTicketExternalStatusChangedTargets.
  reference?: string | null
  externalStatus?: string
  transition?: 'closed' | 'reopened' | null
}

export const notificationHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { principalIds } = target as NotificationTarget
    const cfg = config as NotificationConfig

    if (!principalIds || principalIds.length === 0) {
      return { success: true }
    }

    // Anti-spam gate for the new-message team bell (WO-3 slice 5), moved
    // here from notifyVisitorMessage's request-time check: only ping the
    // team on the first message of a conversation, or when nobody is around
    // to see it live. isAnyAgentOnline is a single GLOBAL Redis check, not
    // per-recipient, so it's evaluated once for the whole target. This is a
    // deliberate skew from notifyVisitorMessage's own (still request-time)
    // presence check for the offline email — the two are never unified.
    if (event.type === 'message.created' && !cfg.isFirstMessage) {
      const { isAnyAgentOnline } = await import('@/lib/server/realtime/presence')
      if (await isAnyAgentOnline()) {
        return { success: true }
      }
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

      // Filter by the per-type x per-channel preference matrix. Batch-load
      // prefs for the distinct principals in the built notifications (may be
      // a subset of `principalIds` for events with duplicate targets).
      const distinctPrincipalIds = [...new Set(notifications.map((n) => n.principalId))]
      const prefsMap = await batchGetNotificationPreferences(distinctPrincipalIds)
      const filtered = filterByInAppPreference(notifications, prefsMap)

      if (filtered.length === 0) {
        return { success: true }
      }

      const ids = await createNotificationsBatch(filtered)

      // The notifiedAt watermark for an internal-note @-mention lives on the
      // conversation domain's own mention rows, not on the notification row
      // itself — stamp it only AFTER the batch above actually landed. It is
      // deliberately best-effort: the notification hook is NOT idempotency-
      // claimed (process.ts calls run() without claiming; only per-hook claims
      // exist, e.g. webhook.ts), and createNotificationsBatch has no dedup key,
      // so if this stamp threw a retryable error the whole hook would retry and
      // re-insert duplicate chat_mention rows. Swallowing a stamp failure keeps
      // the same end-state the original synchronous code had on failure (rows
      // inserted, left un-watermarked) without the double-insert.
      if (event.type === 'conversation.note_mentioned') {
        try {
          const { markConversationMentionsNotified } =
            await import('@/lib/server/domains/conversation/sync-conversation-mentions')
          await markConversationMentionsNotified(
            event.data.conversationMessageId as ConversationMessageId,
            filtered.map((n) => n.principalId)
          )
        } catch (err) {
          log.warn(
            { err, conversation_message_id: event.data.conversationMessageId },
            'failed to stamp note-mention notifiedAt watermark (notifications already sent)'
          )
        }
      }

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
        actorName: commenterName,
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
        changelogId: changelogConfig.changelogId,
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
      metadata: { postUrl: data.postUrl, excerpt: data.excerpt, actorName },
    }))
  }

  if (event.type === 'conversation.assigned') {
    const { conversationId, assignedAgentPrincipalId } = config
    return principalIds.map((principalId) => {
      const isDirectAssignee =
        !!assignedAgentPrincipalId && principalId === assignedAgentPrincipalId
      return {
        principalId,
        type: 'conversation_assigned' as NotificationType,
        title: isDirectAssignee
          ? 'You were assigned a conversation'
          : 'A conversation was assigned to your team',
        metadata: { conversationId },
      }
    })
  }

  if (event.type === 'ticket.assigned') {
    const { ticketId, assignedPrincipalId } = config
    return principalIds.map((principalId) => {
      const isDirectAssignee = !!assignedPrincipalId && principalId === assignedPrincipalId
      return {
        principalId,
        type: 'ticket_assigned' as NotificationType,
        title: isDirectAssignee
          ? 'You were assigned a ticket'
          : 'A ticket was assigned to your team',
        metadata: { ticketId },
      }
    })
  }

  if (event.type === 'assistant.handed_off') {
    const { conversationId, reason } = config
    return principalIds.map((principalId) => ({
      principalId,
      type: 'assistant_handed_off' as NotificationType,
      title: 'Quinn handed off a conversation',
      body: truncate(reason ?? '', 150),
      metadata: { conversationId },
    }))
  }

  if (event.type === 'conversation.note_mentioned') {
    const { conversationId, authorName, preview } = config
    return principalIds.map((principalId) => ({
      principalId,
      type: 'chat_mention' as NotificationType,
      title: `${authorName} mentioned you in a conversation`,
      body: preview,
      metadata: { conversationId, actorName: authorName },
    }))
  }

  if (event.type === 'ticket.status_changed') {
    const { ticketId, title, stageLabel, previousStageLabel, requesterPrincipalId } = config
    const body = previousStageLabel
      ? `Moved from ${previousStageLabel} to ${stageLabel}`
      : 'Open the ticket to see the latest update.'
    return principalIds.map((principalId) => ({
      principalId,
      type: 'ticket_status_changed' as NotificationType,
      title: `${title} is now ${stageLabel}`,
      body,
      // audience routes the deep link: the requester's row opens the portal
      // thread, an agent watcher's row opens the admin inbox. A config with no
      // requesterPrincipalId at all is a pre-watchers outbox row being
      // redrained — omit audience so the client's portal default preserves its
      // requester-only behavior.
      metadata:
        requesterPrincipalId === undefined
          ? { ticketId }
          : {
              ticketId,
              audience:
                requesterPrincipalId && principalId === requesterPrincipalId ? 'portal' : 'admin',
            },
    }))
  }

  if (event.type === 'ticket.replied') {
    const { ticketId, title, authorName, preview, requesterPrincipalId } = config
    return principalIds.map((principalId) => ({
      principalId,
      type: 'ticket_replied' as NotificationType,
      title: `${authorName} replied on ${title}`,
      body: preview,
      metadata: {
        ticketId,
        actorName: authorName,
        audience: requesterPrincipalId && principalId === requesterPrincipalId ? 'portal' : 'admin',
      },
    }))
  }

  if (event.type === 'ticket.note_added') {
    const { ticketId, title, authorName, preview } = config
    return principalIds.map((principalId) => ({
      principalId,
      type: 'ticket_note_added' as NotificationType,
      title: `${authorName} added an internal note on ${title}`,
      body: preview,
      // Note recipients are always agents (role-filtered in the target builder).
      metadata: { ticketId, actorName: authorName, audience: 'admin' },
    }))
  }

  if (event.type === 'ticket.external_status_changed') {
    const { ticketId, title, reference, externalStatus, transition } = config
    const issueLabel = reference ? `Linked issue ${reference}` : 'A linked issue'
    const verb =
      transition === 'closed'
        ? 'was closed'
        : transition === 'reopened'
          ? 'was reopened'
          : `moved to "${externalStatus}"`
    return principalIds.map((principalId) => ({
      principalId,
      type: 'ticket_external_status_changed' as NotificationType,
      title: `${issueLabel} ${verb} on ${title}`,
      // Recipients are always agent watchers (role-filtered in the target builder).
      metadata: { ticketId, audience: 'admin' },
    }))
  }

  if (event.type === 'message.created') {
    const { conversationId, authorName, preview } = config
    return principalIds.map((principalId) => ({
      principalId,
      type: 'chat_message' as NotificationType,
      title: `New message from ${authorName}`,
      body: preview,
      metadata: { conversationId, actorName: authorName },
    }))
  }

  if (event.type === 'status.incident_created' || event.type === 'status.maintenance_scheduled') {
    const c = config as Record<string, unknown>
    const incidentTitle = (c.incidentTitle as string) ?? 'Status update'
    const isMaintenance = event.type === 'status.maintenance_scheduled'
    const title = isMaintenance
      ? `Scheduled maintenance: ${incidentTitle}`
      : `New incident: ${incidentTitle}`
    return principalIds.map((principalId) => ({
      principalId,
      type: 'status_incident' as NotificationType,
      title,
      body: truncate((c.statusLabel as string) ?? '', 150),
      metadata: {
        incidentId: c.incidentId,
        incidentTitle,
        incidentUrl: c.incidentUrl,
        kind: c.kind,
        impact: c.impact,
        statusLabel: c.statusLabel,
      },
    }))
  }

  return []
}

/**
 * Filter built notifications down to the ones each principal's in-app
 * preference matrix allows. A principal with no entry in `prefsMap` keeps
 * every notification (default-on, matches `shouldNotify`'s own default) —
 * this is the no-regression path for every existing user until they touch
 * the preference matrix.
 */
export function filterByInAppPreference(
  notifications: CreateNotificationInput[],
  prefsMap: Map<PrincipalId, NotificationPreferencesData>
): CreateNotificationInput[] {
  return notifications.filter((n) => {
    const prefs = prefsMap.get(n.principalId)
    if (!prefs) return true
    return shouldNotify(prefs, n.type, 'inApp')
  })
}
