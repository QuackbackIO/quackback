/**
 * Coverage for the notification -> route resolution table. This is the single
 * place that decides where clicking a notification navigates, so every
 * notification type and its "id missing" degenerate case is asserted here
 * rather than only exercised indirectly through the component.
 */
import { describe, it, expect } from 'vitest'
import type { NotificationId } from '@quackback/ids'
import { getNotificationTarget } from '../notification-target'
import type { SerializedNotification } from '@/lib/client/hooks/use-notifications-queries'

function buildNotification(overrides: Partial<SerializedNotification>): SerializedNotification {
  return {
    id: 'notification_x' as NotificationId,
    principalId: 'principal_x',
    type: 'comment_created',
    title: 'Title',
    body: null,
    postId: null,
    commentId: null,
    conversationId: null,
    ticketId: null,
    changelogId: null,
    actorName: null,
    actorAvatarUrl: null,
    readAt: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    post: null,
    ...overrides,
  }
}

describe('getNotificationTarget', () => {
  it('routes post_status_changed with post+postId to the post', () => {
    const notification = buildNotification({
      type: 'post_status_changed',
      postId: 'post_1',
      post: { id: 'post_1', title: 'A post', boardSlug: 'feedback' },
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/b/$slug/posts/$postId',
      params: { slug: 'feedback', postId: 'post_1' },
    })
  })

  it('routes comment_created with a commentId to the post, anchored to the comment', () => {
    const notification = buildNotification({
      type: 'comment_created',
      postId: 'post_2',
      commentId: 'post_comment_1',
      post: { id: 'post_2', title: 'A post', boardSlug: 'ideas' },
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/b/$slug/posts/$postId',
      params: { slug: 'ideas', postId: 'post_2' },
      hash: 'comment-post_comment_1',
    })
  })

  it('routes comment_created without a commentId to the post, with no hash', () => {
    const notification = buildNotification({
      type: 'comment_created',
      postId: 'post_2b',
      commentId: null,
      post: { id: 'post_2b', title: 'A post', boardSlug: 'ideas' },
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/b/$slug/posts/$postId',
      params: { slug: 'ideas', postId: 'post_2b' },
    })
  })

  it('routes post_mentioned with post+postId to the post', () => {
    const notification = buildNotification({
      type: 'post_mentioned',
      postId: 'post_3',
      post: { id: 'post_3', title: 'A post', boardSlug: 'roadmap' },
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/b/$slug/posts/$postId',
      params: { slug: 'roadmap', postId: 'post_3' },
    })
  })

  it('routes chat_mention with a conversationId to the inbox', () => {
    const notification = buildNotification({
      type: 'chat_mention',
      conversationId: 'conversation_1',
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/admin/inbox',
      search: { i: 'conversation_1' },
    })
  })

  it('routes chat_message with a conversationId to the inbox', () => {
    const notification = buildNotification({
      type: 'chat_message',
      conversationId: 'conversation_2',
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/admin/inbox',
      search: { i: 'conversation_2' },
    })
  })

  it('routes ticket_status_changed with a ticketId to the ticket thread', () => {
    const notification = buildNotification({
      type: 'ticket_status_changed',
      ticketId: 'ticket_1',
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/support/ticket/$ticketId',
      params: { ticketId: 'ticket_1' },
    })
  })

  it('routes changelog_published with a changelogId to the specific entry', () => {
    const notification = buildNotification({
      type: 'changelog_published',
      changelogId: 'changelog_1',
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/changelog/$entryId',
      params: { entryId: 'changelog_1' },
    })
  })

  it('routes changelog_published without a changelogId to the changelog index', () => {
    const notification = buildNotification({ type: 'changelog_published', changelogId: null })
    expect(getNotificationTarget(notification)).toEqual({ to: '/changelog' })
  })

  it('returns null for chat_mention with no conversationId', () => {
    const notification = buildNotification({ type: 'chat_mention', conversationId: null })
    expect(getNotificationTarget(notification)).toBeNull()
  })

  it('returns null for chat_message with no conversationId', () => {
    const notification = buildNotification({ type: 'chat_message', conversationId: null })
    expect(getNotificationTarget(notification)).toBeNull()
  })

  it('returns null for ticket_status_changed with no ticketId', () => {
    const notification = buildNotification({ type: 'ticket_status_changed', ticketId: null })
    expect(getNotificationTarget(notification)).toBeNull()
  })

  it('returns null for a redacted row (postId set but post stripped)', () => {
    const notification = buildNotification({
      type: 'comment_created',
      postId: 'post_4',
      post: null,
    })
    expect(getNotificationTarget(notification)).toBeNull()
  })

  it('prefers the post link over a conversation/ticket id on the same row', () => {
    const notification = buildNotification({
      type: 'comment_created',
      postId: 'post_5',
      post: { id: 'post_5', title: 'A post', boardSlug: 'feedback' },
      conversationId: 'conversation_9',
      ticketId: 'ticket_9',
    })
    expect(getNotificationTarget(notification)).toEqual({
      to: '/b/$slug/posts/$postId',
      params: { slug: 'feedback', postId: 'post_5' },
    })
  })
})
