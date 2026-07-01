/**
 * markConversationUnreadFromMessage routing (LEAK GUARD): moving the agent
 * read-watermark backward must stay on the inbox channel (publishAgentConversationEvent)
 * so the visitor never sees a "seen" indicator revert. Also covers the agent
 * gate and the backwards-only watermark.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationMessageId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const publishConversationEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()

// The agent watermark + anchor createdAt that the SELECTs resolve to.
let agentLastReadAt: Date | null = null
let messageRow: Record<string, unknown> | null = null

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: (...a: unknown[]) => publishConversationEvent(...a),
  publishAgentConversationEvent: (...a: unknown[]) => publishAgentConversationEvent(...a),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn((a: { principalId: string }) => ({ principalId: a.principalId })),
  loadAuthors: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/server/db', () => {
  function chain(label: string): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = (t: { __name?: string }) => chain(t?.__name ?? label)
    c.set = () => c
    c.where = () => c
    c.limit = async () =>
      label === 'conversation_messages'
        ? messageRow
          ? [messageRow]
          : []
        : [{ id: 'conversation_1', agentLastReadAt }]
    return c
  }
  return {
    db: {
      select: () => chain('select'),
      update: (t: { __name?: string }) => chain(t?.__name ?? 'unknown'),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    inArray: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    conversationMessages: { __name: 'conversation_messages', id: 'id', createdAt: 'created_at' },
    principal: { __name: 'principal' },
  }
})

import { markConversationUnreadFromMessage } from '../conversation.service'

const agent: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}
const visitor: Actor = {
  principalId: 'principal_visitor' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

const anchorCreatedAt = new Date('2026-06-03T12:00:00.000Z')

beforeEach(() => {
  agentLastReadAt = new Date('2026-06-03T13:00:00.000Z') // anchor already read
  messageRow = { createdAt: anchorCreatedAt, deletedAt: null }
  vi.clearAllMocks()
})

describe('markConversationUnreadFromMessage', () => {
  it('publishes the backward read watermark on the inbox channel only', async () => {
    await markConversationUnreadFromMessage(
      'conversation_1' as ConversationId,
      'conversation_msg_1' as ConversationMessageId,
      agent
    )
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishAgentConversationEvent.mock.calls[0][0]).toMatchObject({
      kind: 'read',
      side: 'agent',
      at: new Date(anchorCreatedAt.getTime() - 1).toISOString(),
    })
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('refuses a non-team actor', async () => {
    await expect(
      markConversationUnreadFromMessage(
        'conversation_1' as ConversationId,
        'conversation_msg_1' as ConversationMessageId,
        visitor
      )
    ).rejects.toThrow()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('404s an anchor that does not belong to the conversation', async () => {
    messageRow = null
    await expect(
      markConversationUnreadFromMessage(
        'conversation_1' as ConversationId,
        'conversation_msg_missing' as ConversationMessageId,
        agent
      )
    ).rejects.toThrow()
  })
})
