import { describe, it, expect, vi, beforeEach } from 'vitest'

const { batchSpy } = vi.hoisted(() => ({
  batchSpy: vi.fn().mockResolvedValue(['notif-id-1']),
}))

vi.mock('@/lib/server/domains/notifications/notification.service', () => ({
  createNotificationsBatch: batchSpy,
}))

import { notificationHook } from '../handlers/notification'
import type { NotificationTarget, NotificationConfig } from '../handlers/notification'
import type { EventData } from '../types'

beforeEach(() => batchSpy.mockClear())

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
    const config: NotificationConfig = {}

    const result = await notificationHook.run(event, target, config)
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
})
