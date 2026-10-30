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

  // A ticket ASSIGNMENT notifies a team member, so it deep-links into the admin
  // unified inbox (which accepts a ticket id via `?i=`, per the `?t=`→`?i=` alias
  // in routes/admin/tickets.tsx). Routing it to the portal thread would 404: that
  // view is requester-only (getMyTicketFn gates on requesterPrincipalId === actor),
  // and an assignee is never the requester.
  if (notification.type === 'ticket_assigned' && notification.ticketId) {
    return { to: '/admin/inbox', search: { i: notification.ticketId } }
  }

  // Ticket-stage changes and replies reach two audiences since watchers: the
  // requester (their thread on the converged Messages surface — an agent inbox
  // link would strand them) and agent watchers (admin inbox — the requester
  // thread is ownership-gated and would 404 for them). The per-recipient
  // `audience` metadata stamped by buildNotifications disambiguates. The
  // requester deep link is the PAIR's conversation (there is no standalone
  // ticket page), carried as conversationId by the target builders.
  if (
    (notification.type === 'ticket_status_changed' || notification.type === 'ticket_replied') &&
    notification.ticketId
  ) {
    if (notification.audience === 'admin') {
      return { to: '/admin/inbox', search: { i: notification.ticketId } }
    }
    if (notification.conversationId) {
      return {
        to: '/support/$conversationId',
        params: { conversationId: notification.conversationId },
      }
    }
    return { to: '/support' }
  }

  // Internal-note and linked-issue bells only ever reach agents (role-filtered
  // in the target builder), so the admin inbox is always the destination.
  if (
    (notification.type === 'ticket_note_added' ||
      notification.type === 'ticket_external_status_changed') &&
    notification.ticketId
  ) {
    return { to: '/admin/inbox', search: { i: notification.ticketId } }
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
