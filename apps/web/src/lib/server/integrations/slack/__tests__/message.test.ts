/**
 * Tests for Slack message building — support-conversation events.
 */

import { describe, it, expect } from 'vitest'
import { buildSlackMessage } from '../message'
import type { EventData } from '../../../events/types'

const ROOT_URL = 'https://feedback.example.com'

const envelope = {
  id: 'evt_1',
  timestamp: '2026-07-21T12:00:00.000Z',
  actor: { type: 'user' as const, id: 'principal_1', name: 'Test User' },
}

const conversationRef = {
  id: 'conv_123',
  status: 'open' as const,
  channel: 'messenger' as const,
  priority: 'none' as const,
}

function conversationCreatedEvent(overrides: Record<string, unknown> = {}): EventData {
  return {
    ...envelope,
    type: 'conversation.created',
    data: {
      conversation: {
        ...conversationRef,
        subject: 'Cannot log in <on> my tablet',
        visitorPrincipalId: 'principal_2',
        visitorEmail: 'vera@example.com',
        assignedAgentPrincipalId: null,
        createdAt: '2026-07-21T12:00:00.000Z',
        lastMessageAt: '2026-07-21T12:00:00.000Z',
        resolvedAt: null,
        ...overrides,
      },
    },
  } as EventData
}

function messageCreatedEvent(
  senderType: 'visitor' | 'agent',
  content = '<p>Hello, I need help & <b>advice</b></p>'
): EventData {
  return {
    ...envelope,
    type: 'message.created',
    data: {
      message: {
        id: 'msg_1',
        conversationId: 'conv_123',
        senderType,
        authorPrincipalId: 'principal_2',
        authorName: 'Vera',
        authorEmail: 'vera@example.com',
        content,
        createdAt: '2026-07-21T12:00:00.000Z',
      },
      conversation: conversationRef,
    },
  } as EventData
}

describe('buildSlackMessage — conversation.created', () => {
  it('renders visitor, subject and an inbox deep-link', () => {
    const msg = buildSlackMessage(conversationCreatedEvent(), ROOT_URL)
    expect(msg).not.toBeNull()
    const flat = JSON.stringify(msg)
    expect(msg?.text).toContain('vera@example.com')
    expect(flat).toContain(`${ROOT_URL}/admin/inbox?c=conv_123`)
    // subject is mrkdwn-escaped
    expect(flat).toContain('Cannot log in &lt;on&gt; my tablet')
  })

  it('falls back for anonymous visitors and missing subjects', () => {
    const msg = buildSlackMessage(
      conversationCreatedEvent({ subject: null, visitorEmail: null }),
      ROOT_URL
    )
    expect(msg).not.toBeNull()
    expect(msg?.text.toLowerCase()).toContain('anonymous')
  })
})

describe('buildSlackMessage — message.created', () => {
  it('renders a visitor message with escaped content and an inbox deep-link', () => {
    const msg = buildSlackMessage(messageCreatedEvent('visitor'), ROOT_URL)
    expect(msg).not.toBeNull()
    const flat = JSON.stringify(msg)
    expect(msg?.text).toContain('Vera')
    expect(flat).toContain(`${ROOT_URL}/admin/inbox?c=conv_123`)
    // content is HTML: tags stripped, then mrkdwn-escaped
    expect(flat).toContain('Hello, I need help &amp; advice')
    expect(flat).not.toContain('<b>')
  })

  it('returns null for agent messages so replies never notify', () => {
    expect(buildSlackMessage(messageCreatedEvent('agent'), ROOT_URL)).toBeNull()
  })
})

describe('buildSlackMessage — existing events keep working', () => {
  it('still returns a generic message for unhandled event types', () => {
    const msg = buildSlackMessage(
      { ...envelope, type: 'post.unmerged', data: {} } as unknown as EventData,
      ROOT_URL
    )
    expect(msg).not.toBeNull()
  })
})
