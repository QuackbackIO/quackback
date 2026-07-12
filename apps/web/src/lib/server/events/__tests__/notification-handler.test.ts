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
