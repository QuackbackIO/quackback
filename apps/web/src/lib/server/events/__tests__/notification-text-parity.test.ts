/**
 * The bell words a portal user's notifications again in their language
 * (`notificationText`) from the values the server stores with each row. In
 * English that has to be exactly what the server stored, or English readers see
 * the wording change; in another language it has to differ, or the row is
 * missing a value and quietly falls back to the stored English.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createIntl } from 'react-intl'

const { batchSpy } = vi.hoisted(() => ({
  batchSpy: vi.fn().mockResolvedValue(['notif-id-1']),
}))

vi.mock('@/lib/server/domains/notifications/notification.service', () => ({
  createNotificationsBatch: batchSpy,
}))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/lib/server/domains/conversation/sync-conversation-mentions', () => ({
  markConversationMentionsNotified: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/realtime/presence', () => ({
  isAnyAgentOnline: vi.fn().mockResolvedValue(false),
}))

import en from '@/locales/en.json'
import pl from '@/locales/pl.json'
import {
  notificationText,
  type NotificationTextSource,
} from '@/lib/shared/notifications/notification-text'
import { notificationTextParams } from '@/lib/shared/notifications/text-params'
import { notificationHook } from '../handlers/notification'
import type { EventData } from '../types'

const english = createIntl({ locale: 'en', defaultLocale: 'en', messages: en })
const polish = createIntl({ locale: 'pl', defaultLocale: 'en', messages: pl })

// Fields every test event shares; the handler words these rows from `config`.
const base = {
  id: 'evt-1',
  timestamp: new Date().toISOString(),
  actor: { type: 'user', principalId: 'principal_actor', displayName: 'Alex' },
} as const

const post = { postId: 'post_1', postTitle: 'Dark mode', boardSlug: 'ideas', postUrl: '/p/1' }
const ticket = { ticketId: 'ticket_1', conversationId: 'conv_1', title: 'Cannot log in' }
const incident = { incidentId: 'inc_1', incidentTitle: 'API outage', incidentUrl: '/status/1' }

// `rewordsBody`: the bell words the body again too, not only the title.
const CASES: {
  name: string
  event: EventData
  config: Record<string, unknown>
  rewordsBody?: boolean
}[] = [
  {
    name: 'post status changed',
    rewordsBody: true,
    event: { ...base, type: 'post.status_changed', data: {} } as EventData,
    config: { ...post, previousStatus: 'Open', newStatus: 'Planned' },
  },
  {
    name: 'comment',
    event: { ...base, type: 'comment.created', data: {} } as EventData,
    config: {
      ...post,
      commentId: 'c_1',
      commenterName: 'Sam',
      commentPreview: 'Nice',
      isTeamMember: false,
    },
  },
  {
    name: 'team comment',
    event: { ...base, type: 'comment.created', data: {} } as EventData,
    config: {
      ...post,
      commentId: 'c_1',
      commenterName: 'Sam',
      commentPreview: 'Nice',
      isTeamMember: true,
    },
  },
  {
    name: 'post mention',
    event: {
      ...base,
      type: 'post.mentioned',
      data: {
        postId: 'post_1',
        postTitle: 'Dark mode',
        postUrl: '/p/1',
        mentionedPrincipalId: 'principal_target',
        mentioningPrincipalId: 'principal_actor',
        excerpt: 'Take a look',
      },
    } as EventData,
    config: {},
  },
  {
    name: 'changelog',
    event: { ...base, type: 'changelog.published', data: {} } as EventData,
    config: {
      changelogId: 'cl_1',
      changelogTitle: 'Dark mode is here',
      changelogUrl: '/c/1',
      contentPreview: 'It shipped',
    },
  },
  {
    name: 'incident',
    event: { ...base, type: 'status.incident_created', data: {} } as EventData,
    config: { ...incident, kind: 'incident', impact: 'major', statusLabel: 'Investigating' },
  },
  {
    name: 'maintenance',
    event: { ...base, type: 'status.maintenance_scheduled', data: {} } as EventData,
    config: { ...incident, kind: 'maintenance', impact: 'maintenance', statusLabel: 'Scheduled' },
  },
  {
    name: 'chat message',
    event: { ...base, type: 'message.created', data: {} } as EventData,
    config: {
      conversationId: 'conv_1',
      authorName: 'Sam',
      preview: 'Hi there',
      isFirstMessage: true,
    },
  },
  {
    name: 'ticket stage change',
    rewordsBody: true,
    event: { ...base, type: 'ticket.status_changed', data: {} } as EventData,
    config: { ...ticket, stageLabel: 'Resolved', previousStageLabel: 'Received' },
  },
  {
    name: 'ticket stage change with no prior stage',
    rewordsBody: true,
    event: { ...base, type: 'ticket.status_changed', data: {} } as EventData,
    config: { ...ticket, stageLabel: 'Resolved', previousStageLabel: null },
  },
  {
    name: 'ticket reply',
    event: { ...base, type: 'ticket.replied', data: {} } as EventData,
    config: {
      ...ticket,
      authorName: 'Sam',
      preview: 'We fixed it',
      requesterPrincipalId: 'principal_target',
    },
  },
]

/** The row the server stores for `c`, as the bell receives it. */
async function storedRow(c: (typeof CASES)[number]) {
  await notificationHook.run(c.event, { principalIds: ['principal_target' as never] }, c.config)
  const rows = batchSpy.mock.calls.at(-1)![0] as Array<{
    type: NotificationTextSource['type']
    title: string
    body?: string | null
    metadata?: Record<string, unknown>
  }>
  const row = rows[0]!
  const actorName = row.metadata?.actorName
  return {
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    actorName: typeof actorName === 'string' ? actorName : null,
    params: notificationTextParams(row.metadata),
  } satisfies NotificationTextSource
}

describe('notification wording matches the server', () => {
  beforeEach(() => batchSpy.mockClear())

  it.each(CASES)('words a $name in English exactly as stored', async (c) => {
    const n = await storedRow(c)
    expect(notificationText(n, english)).toEqual({ title: n.title, body: n.body })
  })

  it.each(CASES)('words a $name in the reader’s language', async (c) => {
    const n = await storedRow(c)
    const worded = notificationText(n, polish)
    expect(worded.title).not.toBe(n.title)
    if (c.rewordsBody) expect(worded.body).not.toBe(n.body)
  })
})
