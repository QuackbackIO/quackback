/**
 * Reaction + flag publish routing (LEAK GUARD): every agent-only message action
 * must fan out on the inbox channel via publishAgentConversationEvent ONLY — never via
 * publishConversationEvent (which also reaches the visitor's conversation channel). The
 * agent gate and the system/deleted-message guards are exercised too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const publishConversationEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()

// The row the message-load SELECT resolves to (set per test).
let messageRow: Record<string, unknown> | null = null

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: (...a: unknown[]) => publishConversationEvent(...a),
  publishAgentConversationEvent: (...a: unknown[]) => publishAgentConversationEvent(...a),
  publishConversationUpdate: vi.fn(),
}))

// Enrichment is exercised elsewhere; here we only care about routing, so stub it.
vi.mock('../conversation.query', () => ({
  toMessageDTO: (m: Record<string, unknown>) => m,
  loadAuthors: vi.fn(async () => new Map()),
  fallbackAuthor: (principalId: string) => ({ principalId, displayName: null, avatarUrl: null }),
  enrichMessageForAgent: vi.fn(async (m: Record<string, unknown>) => ({
    ...m,
    reactions: [],
    flaggedAt: null,
  })),
}))

vi.mock('@/lib/server/db', () => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.values = () => c
    c.set = () => c
    c.onConflictDoNothing = async () => []
    c.limit = async () => (messageRow ? [messageRow] : [])
    // Make `await db.delete(...).where(...)` resolve.
    c.then = (resolve: (v: unknown) => unknown) => resolve(undefined)
    return c
  }
  return {
    db: {
      select: () => chain(),
      insert: () => chain(),
      delete: () => chain(),
    },
    eq: vi.fn(),
    and: vi.fn(),
    conversationMessages: { __name: 'conversation_messages' },
    conversationMessageReactions: { __name: 'conversation_message_reactions' },
    conversationMessageFlags: { __name: 'conversation_message_flags' },
  }
})

import { addMessageReaction, removeMessageReaction, setMessageFlag } from '../message.actions'

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

const publicMessage = {
  id: 'conversation_msg_1',
  conversationId: 'conversation_1',
  senderType: 'visitor',
  principalId: 'principal_visitor',
  isInternal: false,
  deletedAt: null,
  // setMessageFlag re-reads the flag row after writing; give the chain mock a
  // timestamp so its toISOString() doesn't throw.
  flaggedAt: new Date(),
}

beforeEach(() => {
  messageRow = { ...publicMessage }
  vi.clearAllMocks()
})

describe('message reaction/flag publish routing', () => {
  it('adds a reaction on the inbox channel only', async () => {
    await addMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', agent)
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishAgentConversationEvent.mock.calls[0][0]).toMatchObject({
      kind: 'message_updated',
    })
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('removes a reaction on the inbox channel only', async () => {
    await removeMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', agent)
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('flags and unflags without broadcasting (a flag is personal)', async () => {
    await setMessageFlag('conversation_msg_1' as ConversationMessageId, true, agent)
    await setMessageFlag('conversation_msg_1' as ConversationMessageId, false, agent)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })
})

describe('message reaction/flag guards', () => {
  it('refuses a non-team actor and publishes nothing', async () => {
    await expect(
      addMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', visitor)
    ).rejects.toThrow()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('refuses reacting to a system message', async () => {
    messageRow = { ...publicMessage, senderType: 'system', principalId: null }
    await expect(
      setMessageFlag('conversation_msg_1' as ConversationMessageId, true, agent)
    ).rejects.toThrow()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('refuses reacting to a soft-deleted message', async () => {
    messageRow = { ...publicMessage, deletedAt: new Date() }
    await expect(
      addMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', agent)
    ).rejects.toThrow()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })
})
