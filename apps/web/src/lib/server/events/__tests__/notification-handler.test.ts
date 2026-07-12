import { describe, it, expect, vi, beforeEach } from 'vitest'

const { batchSpy, prefsSpy } = vi.hoisted(() => ({
  batchSpy: vi.fn().mockResolvedValue(['notif-id-1']),
  // No stored preferences for any principal in these tests — every
  // notification type defaults to "on", matching pre-matrix behavior.
  prefsSpy: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('@/lib/server/domains/notifications/notification.service', () => ({
  createNotificationsBatch: batchSpy,
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: prefsSpy,
}))

import { notificationHook } from '../handlers/notification'
import type { NotificationTarget } from '../handlers/notification'
import type { EventData } from '../types'

beforeEach(() => {
  batchSpy.mockClear()
  prefsSpy.mockClear()
})

describe('notificationHook — post.mentioned', () => {
  it('creates an in-app notification with type post_mentioned', async () => {
    const event = {
      id: 'evt-1',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: {
        type: 'user',
        principalId: 'principal_mentioner',
        displayName: 'Alex',
      },
      data: {
        postId: 'post_123',
        postTitle: 'My post',
        postUrl: 'https://example.com/posts/post_123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_mentioner',
        excerpt: 'Hey, take a look',
      },
    } as EventData

    const target: NotificationTarget = { principalIds: ['principal_target' as never] }

    const result = await notificationHook.run(event, target, {})
    expect(result.success).toBe(true)
    expect(batchSpy).toHaveBeenCalledTimes(1)
    expect(batchSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: 'principal_target',
          type: 'post_mentioned',
          title: expect.stringContaining('Alex'),
          postId: 'post_123',
        }),
      ])
    )
  })

  it('renders title as "Anonymous user mentioned you" when actor has no displayName', async () => {
    const event = {
      id: 'evt-2',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user' },
      data: {
        postId: 'post_123',
        postTitle: 'My post',
        postUrl: 'https://example.com/posts/post_123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_unknown',
        excerpt: '',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    expect(batchSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining('Anonymous user') }),
      ])
    )
  })

  it('truncates a long post title in the notification body', async () => {
    const longTitle = 'a'.repeat(500)
    const event = {
      id: 'evt-3',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Alex' },
      data: {
        postId: 'post_123',
        postTitle: longTitle,
        postUrl: 'https://example.com/posts/post_123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_alex',
        excerpt: '',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    const call = batchSpy.mock.calls[0][0] as Array<{ body?: string }>
    expect(call[0].body?.length).toBeLessThanOrEqual(150)
  })

  it('includes postUrl and excerpt in the notification metadata', async () => {
    const event = {
      id: 'evt-4',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Alex' },
      data: {
        postId: 'post_123',
        postTitle: 'Title',
        postUrl: 'https://example.com/p/123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_alex',
        excerpt: 'context paragraph',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({
      postUrl: 'https://example.com/p/123',
      excerpt: 'context paragraph',
    })
  })

  it('carries actorName in metadata, same value used in the title', async () => {
    const event = {
      id: 'evt-6',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Alex' },
      data: {
        postId: 'post_123',
        postTitle: 'Title',
        postUrl: 'https://example.com/p/123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_alex',
        excerpt: 'context paragraph',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({ actorName: 'Alex' })
  })

  it('falls back to Anonymous user for actorName when the actor has no displayName', async () => {
    const event = {
      id: 'evt-7',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user' },
      data: {
        postId: 'post_123',
        postTitle: 'Title',
        postUrl: 'https://example.com/p/123',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_unknown',
        excerpt: '',
      },
    } as EventData

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, {})
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({ actorName: 'Anonymous user' })
  })
})

describe('notificationHook — comment.created', () => {
  it('carries actorName in metadata, mirroring commenterName', async () => {
    const event = {
      id: 'evt-8',
      type: 'comment.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Jordan' },
      data: {},
    } as EventData

    const config = {
      postId: 'post_1',
      postTitle: 'A post',
      boardSlug: 'feedback',
      postUrl: 'https://example.com/posts/post_1',
      commentId: 'post_comment_1',
      commenterName: 'Jordan',
      commentPreview: 'Nice work',
      isTeamMember: false,
    }

    await notificationHook.run(event, { principalIds: ['principal_target' as never] }, config)
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({ commenterName: 'Jordan', actorName: 'Jordan' })
  })
})

// WO-3 slice 1: conversation/ticket assignment and assistant hand-off bells,
// routed through the same buildNotifications switch as every other event
// type. Target resolution (who ends up in principalIds) is covered by
// targets-assignment.test.ts; these assert the notification content the
// hook builds once a target already exists.
describe('notificationHook — conversation.assigned', () => {
  it('creates a "you were assigned" bell for the new assignee', async () => {
    const event = {
      id: 'evt-conv-assigned-1',
      type: 'conversation.assigned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor', displayName: 'Jordan' },
      data: {
        conversation: {
          id: 'conversation_1',
          status: 'open',
          channel: 'messenger',
          priority: 'none',
        },
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: null,
      },
    } as EventData

    const target: NotificationTarget = { principalIds: ['principal_agent' as never] }
    const config = { conversationId: 'conversation_1', assignedAgentPrincipalId: 'principal_agent' }

    const result = await notificationHook.run(event, target, config)
    expect(result.success).toBe(true)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_agent',
        type: 'conversation_assigned',
        title: 'You were assigned a conversation',
        metadata: { conversationId: 'conversation_1' },
      }),
    ])
  })

  // WO-3 slice 2 (ported characterization): replaces the deleted
  // notifyTeamAssigned direct write. The row shape is deliberately
  // DIFFERENT from the old direct write: type changes 'chat_message' ->
  // 'conversation_assigned' (this event's type), and the title text is
  // preserved verbatim ('A conversation was assigned to your team'). See
  // conversation-notify.test.ts's notifyTeamAssigned characterization
  // describe block for the pre-move behavior this replaces.
  it('titles a team member "assigned to your team", distinct from the direct assignee', async () => {
    const event = {
      id: 'evt-conv-assigned-2',
      type: 'conversation.assigned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        conversation: {
          id: 'conversation_1',
          status: 'open',
          channel: 'messenger',
          priority: 'none',
        },
        assignedAgentPrincipalId: 'principal_agent',
        previousAgentPrincipalId: null,
        assignedTeamId: 'team_1',
        previousTeamId: null,
      },
    } as EventData

    const target: NotificationTarget = {
      principalIds: ['principal_agent' as never, 'principal_teammate' as never],
    }
    const config = { conversationId: 'conversation_1', assignedAgentPrincipalId: 'principal_agent' }

    await notificationHook.run(event, target, config)
    const batch = batchSpy.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toEqual([
      expect.objectContaining({
        principalId: 'principal_agent',
        type: 'conversation_assigned',
        title: 'You were assigned a conversation',
      }),
      expect.objectContaining({
        principalId: 'principal_teammate',
        type: 'conversation_assigned',
        title: 'A conversation was assigned to your team',
        metadata: { conversationId: 'conversation_1' },
      }),
    ])
  })
})

describe('notificationHook — ticket.assigned', () => {
  it('titles the direct assignee "you were assigned" and everyone else "your team"', async () => {
    const event = {
      id: 'evt-ticket-assigned-1',
      type: 'ticket.assigned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: 'principal_actor' },
      data: {
        ticket: { id: 'ticket_1', number: 1, type: 'customer', priority: 'none' },
        assignedPrincipalId: 'principal_agent',
        previousPrincipalId: null,
        assignedTeamId: 'team_1',
        previousTeamId: null,
      },
    } as EventData

    const target: NotificationTarget = {
      principalIds: ['principal_agent' as never, 'principal_teammate' as never],
    }
    const config = { ticketId: 'ticket_1', assignedPrincipalId: 'principal_agent' }

    await notificationHook.run(event, target, config)
    const batch = batchSpy.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toEqual([
      expect.objectContaining({
        principalId: 'principal_agent',
        type: 'ticket_assigned',
        title: 'You were assigned a ticket',
        metadata: { ticketId: 'ticket_1' },
      }),
      expect.objectContaining({
        principalId: 'principal_teammate',
        type: 'ticket_assigned',
        title: 'A ticket was assigned to your team',
        metadata: { ticketId: 'ticket_1' },
      }),
    ])
  })
})

describe('notificationHook — assistant.handed_off', () => {
  it('creates a hand-off bell with the truncated reason as the body', async () => {
    const event = {
      id: 'evt-handoff-1',
      type: 'assistant.handed_off',
      timestamp: new Date().toISOString(),
      actor: { type: 'service', principalId: 'principal_quinn', displayName: 'Quinn' },
      data: { conversationId: 'conversation_1', reason: 'Customer asked for a human' },
    } as EventData

    const target: NotificationTarget = { principalIds: ['principal_agent' as never] }
    const config = { conversationId: 'conversation_1', reason: 'Customer asked for a human' }

    await notificationHook.run(event, target, config)
    expect(batchSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        principalId: 'principal_agent',
        type: 'assistant_handed_off',
        title: 'Quinn handed off a conversation',
        body: 'Customer asked for a human',
        metadata: { conversationId: 'conversation_1' },
      }),
    ])
  })
})

describe('notificationHook — changelog.published', () => {
  it('includes changelogId in the notification metadata', async () => {
    const event = {
      id: 'evt-5',
      type: 'changelog.published',
      timestamp: new Date().toISOString(),
      actor: { type: 'service' },
      data: {
        changelog: {
          id: 'changelog_1',
          title: 'New feature',
          contentPreview: 'We shipped a thing',
          publishedAt: new Date().toISOString(),
          linkedPostCount: 0,
        },
      },
    } as EventData

    const target: NotificationTarget = { principalIds: ['principal_target' as never] }
    const config = {
      changelogId: 'changelog_1',
      changelogTitle: 'New feature',
      changelogUrl: 'https://example.com/changelog',
      contentPreview: 'We shipped a thing',
    }

    await notificationHook.run(event, target, config)
    const call = batchSpy.mock.calls[0][0] as Array<{ metadata?: Record<string, unknown> }>
    expect(call[0].metadata).toMatchObject({ changelogId: 'changelog_1' })
  })
})
