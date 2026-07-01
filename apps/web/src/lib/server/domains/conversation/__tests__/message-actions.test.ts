/**
 * Reaction + flag publish routing (LEAK GUARD): every agent-only message action
 * must fan out on the inbox channel via publishAgentChatEvent ONLY — never via
 * publishChatEvent (which also reaches the visitor's conversation channel). The
 * agent gate and the system/deleted-message guards are exercised too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const publishChatEvent = vi.fn()
const publishAgentChatEvent = vi.fn()

// The row the message-load SELECT resolves to (set per test).
let messageRow: Record<string, unknown> | null = null

vi.mock('@/lib/server/realtime/chat-channels', () => ({
  publishChatEvent: (...a: unknown[]) => publishChatEvent(...a),
  publishAgentChatEvent: (...a: unknown[]) => publishAgentChatEvent(...a),
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
    conversationMessages: { __name: 'chat_messages' },
    conversationMessageReactions: { __name: 'chat_message_reactions' },
    conversationMessageFlags: { __name: 'chat_message_flags' },
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
  id: 'chat_msg_1',
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
    await addMessageReaction('chat_msg_1' as ConversationMessageId, '👍', agent)
    expect(publishAgentChatEvent).toHaveBeenCalledTimes(1)
    expect(publishAgentChatEvent.mock.calls[0][0]).toMatchObject({ kind: 'message_updated' })
    expect(publishChatEvent).not.toHaveBeenCalled()
  })

  it('removes a reaction on the inbox channel only', async () => {
    await removeMessageReaction('chat_msg_1' as ConversationMessageId, '👍', agent)
    expect(publishAgentChatEvent).toHaveBeenCalledTimes(1)
    expect(publishChatEvent).not.toHaveBeenCalled()
  })

  it('flags and unflags without broadcasting (a flag is personal)', async () => {
    await setMessageFlag('chat_msg_1' as ConversationMessageId, true, agent)
    await setMessageFlag('chat_msg_1' as ConversationMessageId, false, agent)
    expect(publishAgentChatEvent).not.toHaveBeenCalled()
    expect(publishChatEvent).not.toHaveBeenCalled()
  })
})

describe('message reaction/flag guards', () => {
  it('refuses a non-team actor and publishes nothing', async () => {
    await expect(
      addMessageReaction('chat_msg_1' as ConversationMessageId, '👍', visitor)
    ).rejects.toThrow()
    expect(publishAgentChatEvent).not.toHaveBeenCalled()
    expect(publishChatEvent).not.toHaveBeenCalled()
  })

  it('refuses reacting to a system message', async () => {
    messageRow = { ...publicMessage, senderType: 'system', principalId: null }
    await expect(
      setMessageFlag('chat_msg_1' as ConversationMessageId, true, agent)
    ).rejects.toThrow()
    expect(publishAgentChatEvent).not.toHaveBeenCalled()
  })

  it('refuses reacting to a soft-deleted message', async () => {
    messageRow = { ...publicMessage, deletedAt: new Date() }
    await expect(
      addMessageReaction('chat_msg_1' as ConversationMessageId, '👍', agent)
    ).rejects.toThrow()
    expect(publishAgentChatEvent).not.toHaveBeenCalled()
  })
})
