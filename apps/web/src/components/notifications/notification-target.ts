/**
 * Resolves a notification to the in-app route it should deep-link to.
 *
 * `NotificationTarget` is a plain descriptor rather than a route-typed
 * `LinkProps` value: the notification types fan out to routes with
 * different `params`/`search` shapes, and threading each one through the
 * router's generic `Link` typing here would fight the type system for no
 * safety gain (the shapes are validated by each destination route already).
 */
import type { SerializedNotification } from '@/lib/client/hooks/use-notifications-queries'

export interface NotificationTarget {
  to: string
  params?: Record<string, string>
  search?: Record<string, string>
  /** Anchors the target route to a specific element, e.g. a comment within a post thread. */
  hash?: string
}

export function getNotificationTarget(
  notification: SerializedNotification
): NotificationTarget | null {
  if (notification.post && notification.postId) {
    const target: NotificationTarget = {
      to: '/b/$slug/posts/$postId',
      params: { slug: notification.post.boardSlug, postId: notification.postId },
    }
    // Anchor a comment notification to the comment itself rather than just the post.
    if (
      (notification.type === 'comment_created' || notification.type === 'comment_mentioned') &&
      notification.commentId
    ) {
      target.hash = `comment-${notification.commentId}`
    }
    return target
  }

  // Conversation mentions, messages, assignments, and assistant handoffs all deep-link
  // into the inbox conversation. Recipients of these types are always team members
  // (visitor-side conversation updates go through the widget and email, never the bell),
  // so /admin/inbox is the correct target in both the dropdown and the full
  // notifications page.
  if (
    (notification.type === 'chat_mention' ||
      notification.type === 'chat_message' ||
      notification.type === 'conversation_assigned' ||
      notification.type === 'assistant_handed_off') &&
    notification.conversationId
  ) {
    return { to: '/admin/inbox', search: { i: notification.conversationId } }
  }

  // A ticket-stage change notifies the requester (portal); deep-link to the thread.
  // Deliberately NOT `/admin/inbox?i=` (UNIFIED-INBOX-SPEC.md §4 suggests this):
  // `existing.requesterPrincipalId` (ticket.service.ts) is only ever set from
  // `PortalUserPicker`, so every recipient of this notification is a portal
  // customer without admin access — routing them into `/admin/inbox` would
  // strand them outside the workspace they can reach.
  //
  // A ticket assignment notifies a team member instead, but the same thread is the
  // correct destination either way, so it shares this branch.
  if (
    (notification.type === 'ticket_status_changed' || notification.type === 'ticket_assigned') &&
    notification.ticketId
  ) {
    return { to: '/support/ticket/$ticketId', params: { ticketId: notification.ticketId } }
  }

  // Deep-link to the specific changelog entry when we have its id. Rows created
  // before changelogId was threaded through metadata fall back to the index.
  if (notification.type === 'changelog_published') {
    if (notification.changelogId) {
      return { to: '/changelog/$entryId', params: { entryId: notification.changelogId } }
    }
    return { to: '/changelog' }
  }

  // Deep-link to the specific status incident/maintenance, else the status page.
  if (notification.type === 'status_incident') {
    if (notification.incidentId) {
      return { to: '/status/$incidentId', params: { incidentId: notification.incidentId } }
    }
    return { to: '/status' }
  }

  return null
}
