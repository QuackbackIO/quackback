/**
 * deleteChatMessage routing: a public message's deletion fans out to the visitor
 * via publishChatEvent, but an internal note's deletion must stay on the agent
 * inbox channel (the visitor never saw the note, so its id must not surface).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ChatMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const publishChatEvent = vi.fn()
const publishAgentChatEvent = vi.fn()
// The message row the initial SELECT resolves to (set per test).
let messageRow: Record<string, unknown> | null = null

// Hoisted so the (also-hoisted) vi.mock factory can reference the spy bag.
const emit = vi.hoisted(() => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
}))
vi.mock('../chat.webhooks', () => emit)

vi.mock('@/lib/server/realtime/chat-channels', () => ({
  publishChatEvent: (...a: unknown[]) => publishChatEvent(...a),
  publishAgentChatEvent: (...a: unknown[]) => publishAgentChatEvent(...a),
  publishConversationUpdate: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../chat.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
}))

vi.mock('../chat.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn((a: { principalId: string }) => ({ principalId: a.principalId })),
  loadAuthors: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/server/db', () => {
  const conversationRow = {
    id: 'conversation_1',
    visitorPrincipalId: 'principal_visitor',
    assignedAgentPrincipalId: null,
    status: 'open',
  }

  function chain(label: string): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = (t: { __name?: string }) => chain(t?.__name ?? label)
    c.set = () => c
    c.where = () => c
    c.limit = async () =>
      label === 'chat_messages' ? (messageRow ? [messageRow] : []) : [conversationRow]
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
    conversations: { __name: 'conversations', id: 'id' },
    chatMessages: { __name: 'chat_messages', id: 'id' },
  }
})

import { deleteChatMessage } from '../chat.service'

const agentActor: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

beforeEach(() => {
  messageRow = null
  vi.clearAllMocks()
})

describe('deleteChatMessage publish routing', () => {
  it('broadcasts a public message deletion to the visitor channel', async () => {
    messageRow = {
      id: 'chat_msg_1',
      conversationId: 'conversation_1',
      senderType: 'agent',
      principalId: 'principal_agent',
      isInternal: false,
      deletedAt: null,
    }
    await deleteChatMessage('chat_msg_1' as ChatMessageId, agentActor)
    expect(publishChatEvent).toHaveBeenCalledTimes(1)
    expect(publishAgentChatEvent).not.toHaveBeenCalled()
    // A public deletion fires the public message.deleted webhook.
    expect(emit.emitMessageDeleted).toHaveBeenCalledTimes(1)
  })

  it('keeps an internal-note deletion on the agent inbox channel only', async () => {
    messageRow = {
      id: 'chat_msg_note',
      conversationId: 'conversation_1',
      senderType: 'agent',
      principalId: 'principal_agent',
      isInternal: true,
      deletedAt: null,
    }
    await deleteChatMessage('chat_msg_note' as ChatMessageId, agentActor)
    expect(publishAgentChatEvent).toHaveBeenCalledTimes(1)
    expect(publishChatEvent).not.toHaveBeenCalled()
    // The note never reached the visitor, so its deletion fires no public webhook.
    expect(emit.emitMessageDeleted).not.toHaveBeenCalled()
  })
})
