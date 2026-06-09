/**
 * Channel routing for chat events, with a focus on the security-critical
 * invariant that agent-only data (internal notes, captured visitor email)
 * never reaches the visitor's conversation channel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/chat/types'

const publish = vi.fn()
vi.mock('../pubsub', () => ({ publish: (...args: unknown[]) => publish(...args) }))

import {
  conversationChannel,
  CHAT_INBOX_CHANNEL,
  publishChatEvent,
  publishAgentChatEvent,
  publishConversationUpdate,
  publishAgentTyping,
  shouldSuppressOwnAgentTyping,
} from '../chat-channels'

const conversationId = 'conversation_1' as ConversationId

const agentDto = {
  id: conversationId,
  status: 'open',
  priority: 'none',
  channel: 'live_chat',
  subject: null,
  lastMessagePreview: 'hi',
  lastMessageAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  visitor: { principalId: 'principal_v', displayName: null, avatarUrl: null },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: 'visitor@example.com',
  resolvedAt: null,
  endReason: null,
  endNote: 'internal end note',
  tags: [{ id: 'chat_tag_1', name: 'VIP', color: '#ff0000' }],
} as unknown as ConversationDTO

beforeEach(() => vi.clearAllMocks())

describe('publishChatEvent', () => {
  it('fans out to both the conversation channel and the inbox', () => {
    publishChatEvent(conversationId, { kind: 'read', conversationId, side: 'agent', at: 'x' })
    const channels = publish.mock.calls.map((c) => c[0])
    expect(channels).toContain(conversationChannel(conversationId))
    expect(channels).toContain(CHAT_INBOX_CHANNEL)
  })
})

describe('publishAgentChatEvent', () => {
  it('publishes to the inbox channel ONLY (never the visitor conversation channel)', () => {
    publishAgentChatEvent({ kind: 'conversation', conversation: agentDto })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toBe(CHAT_INBOX_CHANNEL)
  })
})

describe('publishConversationUpdate', () => {
  it('sends the full DTO to the inbox and strips ALL agent-only fields for the visitor', () => {
    publishConversationUpdate(conversationId, agentDto)

    const inbox = publish.mock.calls.find((c) => c[0] === CHAT_INBOX_CHANNEL)
    const visitor = publish.mock.calls.find((c) => c[0] === conversationChannel(conversationId))
    expect(inbox).toBeDefined()
    expect(visitor).toBeDefined()

    // Agents keep agent-only fields...
    const inboxConv = (inbox![1] as { conversation: ConversationDTO }).conversation
    expect(inboxConv.visitorEmail).toBe('visitor@example.com')
    expect(inboxConv.tags).toHaveLength(1)
    expect(inboxConv.endNote).toBe('internal end note')

    // ...the visitor copy must have every agent-only field stripped.
    const visitorConv = (visitor![1] as { conversation: ConversationDTO }).conversation
    expect(visitorConv.visitorEmail).toBeNull()
    expect(visitorConv.tags).toEqual([])
    expect(visitorConv.endNote).toBeNull()
  })
})

describe('publishAgentTyping', () => {
  it('sends the agent id only to the inbox, never to the visitor channel', () => {
    publishAgentTyping(conversationId, '2026-01-01T00:00:00.000Z', 'principal_agent' as never)

    const inbox = publish.mock.calls.find((c) => c[0] === CHAT_INBOX_CHANNEL)
    const visitor = publish.mock.calls.find((c) => c[0] === conversationChannel(conversationId))

    // Inbox carries the agent id (so other agents can detect a collision)...
    expect(inbox![1]).toMatchObject({
      kind: 'typing',
      side: 'agent',
      agentPrincipalId: 'principal_agent',
    })
    // ...the visitor only sees an anonymous "agent is typing" — no id leak.
    expect(visitor![1]).toMatchObject({ kind: 'typing', side: 'agent' })
    expect((visitor![1] as { agentPrincipalId?: string }).agentPrincipalId).toBeUndefined()
  })
})

describe('shouldSuppressOwnAgentTyping', () => {
  const frame = (e: unknown) => JSON.stringify(e)

  it('suppresses an agent typing frame from the same principal', () => {
    expect(
      shouldSuppressOwnAgentTyping(
        frame({ kind: 'typing', side: 'agent', agentPrincipalId: 'p1' }),
        'p1'
      )
    ).toBe(true)
  })

  it('does not suppress another agent, a visitor, a non-typing event, or junk', () => {
    expect(
      shouldSuppressOwnAgentTyping(
        frame({ kind: 'typing', side: 'agent', agentPrincipalId: 'p2' }),
        'p1'
      )
    ).toBe(false)
    expect(shouldSuppressOwnAgentTyping(frame({ kind: 'typing', side: 'visitor' }), 'p1')).toBe(
      false
    )
    expect(shouldSuppressOwnAgentTyping(frame({ kind: 'message' }), 'p1')).toBe(false)
    expect(shouldSuppressOwnAgentTyping('not json{', 'p1')).toBe(false)
  })
})
