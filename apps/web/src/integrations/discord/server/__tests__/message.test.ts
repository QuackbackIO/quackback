/**
 * Discord message building for support-conversation events.
 */
import { describe, it, expect } from 'vitest'
import { buildDiscordMessage } from '../message'
import type { EventData } from '@/lib/server/events/types'
import { allOnPrimary } from '@/lib/shared/section-links'

const ROOT_URL = 'https://feedback.example.com'
const links = allOnPrimary(ROOT_URL)

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

function conversationCreated(overrides: Record<string, unknown> = {}): EventData {
  return {
    ...envelope,
    type: 'conversation.created',
    data: {
      conversation: {
        ...conversationRef,
        subject: 'Cannot log in on my tablet',
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

function messageCreated(
  senderType: 'visitor' | 'agent',
  content = '<p>Hello, I need help &amp; <b>advice</b> @everyone</p>'
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
      isFirstMessage: false,
    },
  } as EventData
}

describe('buildDiscordMessage: conversation.created', () => {
  it('links the subject to the inbox and names the visitor and channel', () => {
    const embed = buildDiscordMessage(conversationCreated(), links)?.embeds?.[0]
    expect(embed?.title).toBe('Cannot log in on my tablet')
    expect(embed?.url).toBe(`${ROOT_URL}/admin/inbox?c=conv_123`)
    expect(embed?.author?.name).toContain('vera@example.com')
    expect(embed?.footer?.text).toContain('messenger')
  })

  it('falls back for anonymous visitors and missing subjects', () => {
    const embed = buildDiscordMessage(
      conversationCreated({ subject: '  ', visitorEmail: null }),
      links
    )?.embeds?.[0]
    expect(embed?.title).toBe('New conversation')
    expect(embed?.author?.name).toContain('Anonymous visitor')
  })
})

describe('buildDiscordMessage: message.created', () => {
  it('quotes a customer message as plain text inside an embed linked to the inbox', () => {
    const msg = buildDiscordMessage(messageCreated('visitor'), links)
    // Customer text stays inside the embed, where mentions never ping.
    expect(msg?.content).toBeUndefined()
    const embed = msg?.embeds?.[0]
    expect(embed?.url).toBe(`${ROOT_URL}/admin/inbox?c=conv_123`)
    expect(embed?.author?.name).toContain('Vera')
    expect(embed?.description).toContain('Hello, I need help')
    expect(embed?.description).not.toContain('<b>')
  })

  it('returns null for teammate replies so they never post', () => {
    expect(buildDiscordMessage(messageCreated('agent'), links)).toBeNull()
  })
})
