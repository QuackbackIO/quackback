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
} from '../chat-channels'

const conversationId = 'conversation_1' as ConversationId

const agentDto = {
  id: conversationId,
  status: 'open',
  priority: 'none',
  channel: 'live_chat',
  tags: [{ id: 'tag_1', name: 'VIP', color: '#ff0000' }],
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

    // ...the visitor copy must have every agent-only field stripped.
    const visitorConv = (visitor![1] as { conversation: ConversationDTO }).conversation
    expect(visitorConv.visitorEmail).toBeNull()
    // Internal triage tags are agent-only and must never reach the visitor wire.
    expect(visitorConv.tags).toEqual([])
  })
})
