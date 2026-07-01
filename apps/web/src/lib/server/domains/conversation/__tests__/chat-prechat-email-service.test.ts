/**
 * Pre-chat email capture in sendVisitorMessage: a valid address is stored on the
 * conversation on the first message, malformed input is ignored, and an address
 * already on the conversation is never overwritten by a later send.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const insertedConversations: Record<string, unknown>[] = []
const updatedSets: Record<string, unknown>[] = []
// Drives the tx.select(...).limit() result for the existing-conversation path.
let existingConversation: Record<string, unknown> | null = null

vi.mock('@/lib/server/realtime/chat-channels', () => ({
  publishChatEvent: vi.fn(),
  publishAgentChatEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
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
  toMessageDTO: vi.fn((m: Record<string, unknown>) => ({ id: m.id, ...m })),
  authorFromInput: vi.fn((a: { principalId: string }) => ({ principalId: a.principalId })),
  loadAuthors: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/server/db', () => {
  function freshConversation(extra: Record<string, unknown> = {}) {
    return {
      id: 'conversation_new',
      visitorPrincipalId: 'principal_visitor',
      assignedAgentPrincipalId: null,
      status: 'open',
      subject: null,
      lastMessagePreview: null,
      lastMessageAt: new Date(),
      visitorLastReadAt: null,
      agentLastReadAt: null,
      csatRating: null,
      visitorEmail: null,
      createdAt: new Date(),
      updatedAt: null,
      ...extra,
    }
  }

  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = (row: Record<string, unknown>) => {
      if (label === 'conversations') insertedConversations.push(row)
      return c
    }
    c.set = (vals: Record<string, unknown>) => {
      if (label === 'conversations') updatedSets.push(vals)
      return c
    }
    // tx.select() has no table; .from(conversations) relabels so limit() resolves.
    c.from = (t: { __name?: string }) => chain(t?.__name ?? label)
    c.where = () => c
    c.limit = async () =>
      label === 'conversations' && existingConversation ? [existingConversation] : []
    c.returning = async () => {
      if (label === 'conversations') return [freshConversation()]
      if (label === 'chat_messages') return [{ id: 'chat_msg_new', createdAt: new Date() }]
      return []
    }
    return c
  }

  const tx = {
    select: () => chain('select'),
    insert: (t: { __name?: string }) => chain(t?.__name ?? 'unknown'),
    update: (t: { __name?: string }) => chain(t?.__name ?? 'unknown'),
  }

  return {
    db: { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    conversationMessages: { __name: 'chat_messages', id: 'id' },
    principal: { __name: 'principal', id: 'id', contactEmail: 'contact_email' },
  }
})

import { sendVisitorMessage } from '../conversation.service'

const visitor = 'principal_visitor' as PrincipalId
const visitorActor: Actor = {
  principalId: visitor,
  role: 'user',
  principalType: 'anonymous',
  segmentIds: new Set(),
}

beforeEach(() => {
  insertedConversations.length = 0
  updatedSets.length = 0
  existingConversation = null
  vi.clearAllMocks()
})

describe('sendVisitorMessage pre-chat email capture', () => {
  it('stores a normalized email on the first message of a new conversation', async () => {
    await sendVisitorMessage(
      { content: 'hello', visitorEmail: '  Jane@Example.COM ' },
      { principalId: visitor },
      visitorActor
    )
    expect(updatedSets).toHaveLength(1)
    expect(updatedSets[0].visitorEmail).toBe('jane@example.com')
  })

  it('ignores a malformed email', async () => {
    await sendVisitorMessage(
      { content: 'hello', visitorEmail: 'not-an-email' },
      { principalId: visitor },
      visitorActor
    )
    expect(updatedSets).toHaveLength(1)
    expect('visitorEmail' in updatedSets[0]).toBe(false)
  })

  it('does not overwrite an email already on the conversation', async () => {
    existingConversation = {
      id: 'conversation_existing',
      visitorPrincipalId: visitor,
      assignedAgentPrincipalId: null,
      status: 'open',
      subject: null,
      lastMessagePreview: null,
      lastMessageAt: new Date(),
      visitorLastReadAt: null,
      agentLastReadAt: null,
      csatRating: null,
      visitorEmail: 'first@example.com',
      createdAt: new Date(),
      updatedAt: null,
    }
    await sendVisitorMessage(
      {
        conversationId: 'conversation_existing' as ConversationId,
        content: 'hi again',
        visitorEmail: 'second@example.com',
      },
      { principalId: visitor },
      visitorActor
    )
    expect(updatedSets).toHaveLength(1)
    expect('visitorEmail' in updatedSets[0]).toBe(false)
  })

  it('does not write an email when none is provided', async () => {
    await sendVisitorMessage({ content: 'hello' }, { principalId: visitor }, visitorActor)
    expect(updatedSets).toHaveLength(1)
    expect('visitorEmail' in updatedSets[0]).toBe(false)
  })
})
