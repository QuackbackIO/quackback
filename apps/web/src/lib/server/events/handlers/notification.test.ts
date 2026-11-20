import { describe, it, expect, vi } from 'vitest'

const { batchSpy } = vi.hoisted(() => ({ batchSpy: vi.fn() }))
vi.mock('@/lib/server/domains/notifications/notification.service', () => ({
  createNotificationsBatch: batchSpy,
}))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: vi.fn().mockResolvedValue(new Map()),
}))

import { filterByInAppPreference, notificationHook } from './notification'
import type { EventData } from '../types'
import type { CreateNotificationInput } from '@/lib/server/domains/notifications'
import type { NotificationPreferencesData } from '@/lib/server/domains/subscriptions/subscription.service'
import type { PrincipalId } from '@quackback/ids'

function notification(
  principalId: string,
  type: CreateNotificationInput['type']
): CreateNotificationInput {
  return { principalId: principalId as PrincipalId, type, title: 'title' }
}

const DEFAULT_PREFS: NotificationPreferencesData = {
  emailStatusChange: true,
  emailNewComment: true,
  emailMuted: false,
}

describe('filterByInAppPreference', () => {
  it('keeps every notification type for a principal with no stored preferences (default-on)', () => {
    const notifications = [
      notification('principal_a', 'post_status_changed'),
      notification('principal_a', 'comment_created'),
      notification('principal_a', 'post_mentioned'),
      notification('principal_a', 'changelog_published'),
    ]

    const result = filterByInAppPreference(notifications, new Map())

    expect(result).toEqual(notifications)
  })

  it('drops the muted type while keeping other types for the same principal', () => {
    const notifications = [
      notification('principal_a', 'post_status_changed'),
      notification('principal_a', 'comment_created'),
    ]
    const prefsMap = new Map<PrincipalId, NotificationPreferencesData>([
      [
        'principal_a' as PrincipalId,
        { ...DEFAULT_PREFS, matrix: { post_status_changed: { inApp: false } } },
      ],
    ])

    const result = filterByInAppPreference(notifications, prefsMap)

    expect(result).toEqual([notification('principal_a', 'comment_created')])
  })

  it('does not let emailMuted suppress in-app notifications', () => {
    const notifications = [notification('principal_a', 'comment_created')]
    const prefsMap = new Map<PrincipalId, NotificationPreferencesData>([
      ['principal_a' as PrincipalId, { ...DEFAULT_PREFS, emailMuted: true }],
    ])

    const result = filterByInAppPreference(notifications, prefsMap)

    expect(result).toEqual(notifications)
  })

  it('filters per-principal in a mixed batch: only the muted-for-type recipient is dropped', () => {
    const notifications = [
      notification('principal_muted', 'post_status_changed'),
      notification('principal_default', 'post_status_changed'),
    ]
    const prefsMap = new Map<PrincipalId, NotificationPreferencesData>([
      [
        'principal_muted' as PrincipalId,
        { ...DEFAULT_PREFS, matrix: { post_status_changed: { inApp: false } } },
      ],
    ])

    const result = filterByInAppPreference(notifications, prefsMap)

    expect(result).toEqual([notification('principal_default', 'post_status_changed')])
  })
})

describe('notificationHook on a hook retry', () => {
  it('writes the bell rows again: there is no dedup key, so a retried run duplicates them', async () => {
    batchSpy.mockReset().mockResolvedValue(['notif-1'])
    const event = {
      id: 'evt-retry-1',
      type: 'assistant.handed_off',
      timestamp: new Date().toISOString(),
      actor: { type: 'service', principalId: 'principal_ai' },
      data: { conversationId: 'conversation_1', reason: 'Customer asked for a human' },
    } as EventData
    const target = { principalIds: ['principal_agent' as PrincipalId] }
    const config = { conversationId: 'conversation_1', reason: 'Customer asked for a human' }

    // The same event delivered twice, as a retry of the hook would.
    await notificationHook.run(event, target, config)
    await notificationHook.run(event, target, config)

    expect(batchSpy).toHaveBeenCalledTimes(2)
    expect(batchSpy.mock.calls[0][0]).toEqual(batchSpy.mock.calls[1][0])
    expect(batchSpy.mock.calls[0][0]).toEqual([
      expect.objectContaining({ principalId: 'principal_agent', type: 'assistant_handed_off' }),
    ])
  })
})
