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
const principalUpdatedSets: Record<string, unknown>[] = []
// Drives the tx.select(...).limit() result for the existing-conversation path.
let existingConversation: Record<string, unknown> | null = null

// This file fakes the database, and durable Quinn intake writes run rows and a
// queue job inside the send transaction — which needs a real one. The durable
// path has its own committed-transaction suite
// (assistant/__tests__/assistant-run.durability.db.test.ts); here the legacy
// executor keeps the fake-database seam exactly as it was.
process.env.ASSISTANT_EXECUTION_MODE = 'legacy'

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))

// The visitor-send funnel guards on isBlocked; these visitors are never blocked.
vi.mock('@/lib/server/domains/principals/blocking', () => ({
  isBlocked: vi.fn(async () => false),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
}))

vi.mock('@/lib/server/domains/changelog/changelog-subscription.service', () => ({
  ensureAutoSubscribed: vi.fn(async () => {}),
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
      if (label === 'principal') principalUpdatedSets.push(vals)
      return c
    }
    // tx.select() has no table; .from(conversations) relabels so limit() resolves.
    c.from = (t: { __name?: string }) => chain(t?.__name ?? label)
    c.innerJoin = () => c
    c.where = () => c
    const rows = () =>
      label === 'conversations' && existingConversation
        ? [existingConversation]
        : label === 'principal'
          ? [
              {
                id: 'principal_visitor',
                type: 'anonymous',
                displayName: 'Visitor',
                contactEmail: null,
                userId: 'user_visitor',
              },
            ]
          : []
    c.limit = () => c
    c.for = () => c
    c.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows()).then(resolve)
    c.returning = async () => {
      if (label === 'principal') return [{ id: 'principal_visitor' }]
      if (label === 'conversations') return [freshConversation()]
      if (label === 'conversation_messages')
        return [{ id: 'conversation_msg_new', createdAt: new Date() }]
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
    // The durable Quinn fence bumps conversations.assistant_revision inside
    // the same UPDATE as each lifecycle change, so this partial mock has to
    // carry `sql` now.
    sql: vi.fn((...parts: unknown[]) => ({ __sql: parts })),
    and: vi.fn(),
    isNull: vi.fn(),
    settings: { __name: 'settings', id: 'id' },
    conversations: { __name: 'conversations', id: 'id', assistantRevision: 'assistant_revision' },
    conversationMessages: { __name: 'conversation_messages', id: 'id' },
    principal: { __name: 'principal', id: 'id', contactEmail: 'contact_email' },
    user: { __name: 'user', id: 'id' },
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
  principalUpdatedSets.length = 0
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
    expect(updatedSets.some((row) => row.visitorEmail === 'jane@example.com')).toBe(true)
  })

  it('ignores a malformed email', async () => {
    await sendVisitorMessage(
      { content: 'hello', visitorEmail: 'not-an-email' },
      { principalId: visitor },
      visitorActor
    )
    expect(updatedSets.some((row) => 'visitorEmail' in row)).toBe(false)
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
    expect(updatedSets.filter((row) => 'visitorEmail' in row)).toHaveLength(0)
  })

  it('does not write an email when none is provided', async () => {
    await sendVisitorMessage({ content: 'hello' }, { principalId: visitor }, visitorActor)
    expect(updatedSets.filter((row) => 'visitorEmail' in row)).toHaveLength(0)
  })

  it('stores a name on an anonymous visitor whose current name is generated', async () => {
    await sendVisitorMessage(
      { content: 'hello', visitorName: '  Ada Lovelace  ' },
      { principalId: visitor },
      visitorActor
    )
    expect(principalUpdatedSets.some((row) => row.displayName === 'Ada Lovelace')).toBe(true)
  })
})
