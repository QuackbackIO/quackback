/**
 * P2-D.1: sendAgentMessage attaches translatedFrom to the DTO returned to the
 * sending agent, and to a NEW inbox-only message_updated broadcast for every
 * other open agent thread — without ever widening the shared
 * publishConversationEvent payload the visitor's own widget also receives on
 * the same conversation channel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const insertedMessages: Record<string, unknown>[] = []
const publishConversationEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()
const publishConversationUpdate = vi.fn()

const emit = vi.hoisted(() => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('../conversation.webhooks', () => emit)

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: (...args: unknown[]) => publishConversationEvent(...args),
  publishAgentConversationEvent: (...args: unknown[]) => publishAgentConversationEvent(...args),
  publishConversationUpdate: (...args: unknown[]) => publishConversationUpdate(...args),
}))

// sendAgentMessage fires a (fire-and-forget) reply notification — stub it so
// no real notify pipeline runs.
vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string; status: string }) => ({
    id: c.id,
    status: c.status,
  })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderType: m.senderType,
    content: m.content,
    contentJson: m.contentJson ?? null,
    author: { principalId: m.principalId, displayName: null, avatarUrl: null },
  })),
  resolveAuthor: vi.fn(async (a: { principalId: string }) => ({
    principalId: a.principalId,
    displayName: null,
    avatarUrl: null,
  })),
}))

vi.mock('@/lib/server/db', () => {
  const conversationRow = {
    id: 'conversation_1' as unknown as ConversationId,
    visitorPrincipalId: 'principal_visitor',
    assignedAgentPrincipalId: null,
    status: 'open',
    subject: null,
    lastMessagePreview: null,
    lastMessageAt: new Date(),
    visitorLastReadAt: null,
    agentLastReadAt: null,
    createdAt: new Date(),
    updatedAt: null,
  }

  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = vi.fn((row: Record<string, unknown>) => {
      if (label === 'conversation_messages') insertedMessages.push(row)
      return c
    })
    c.set = vi.fn(() => c)
    c.from = vi.fn(() => c)
    c.where = vi.fn(() => c)
    c.limit = vi.fn(async () => [conversationRow])
    c.orderBy = vi.fn(() => c)
    c.returning = vi.fn(async () => {
      if (label === 'conversation_messages') {
        const last = insertedMessages.at(-1) ?? {}
        return [{ ...last, id: 'conversation_msg_new', createdAt: new Date() }]
      }
      if (label === 'conversations') return [{ ...conversationRow }]
      return []
    })
    return c
  }

  const tx = {
    select: () => chain('select'),
    insert: (table: { __name?: string }) => chain(table?.__name ?? 'unknown'),
    update: (table: { __name?: string }) => chain(table?.__name ?? 'unknown'),
  }

  return {
    db: {
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      select: vi.fn(() => chain('select')),
      insert: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
      update: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
    },
    eq: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    conversationMessages: { __name: 'conversation_messages', id: 'id' },
  }
})

import { sendAgentMessage } from '../conversation.service'

const conversationId = 'conversation_1' as ConversationId
const agentPrincipalId = 'principal_agent' as PrincipalId
const agent = { principalId: agentPrincipalId, displayName: 'Jane', avatarUrl: null }
const agentActor: Actor = {
  principalId: agentPrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const translatedFrom = { originalContent: 'Hi there', sourceLocale: 'en', targetLocale: 'fr' }

beforeEach(() => {
  insertedMessages.length = 0
  vi.clearAllMocks()
})

describe('sendAgentMessage — translatedFrom propagation (P2-D.1)', () => {
  it('attaches translatedFrom to the DTO returned to the sending agent', async () => {
    const result = await sendAgentMessage(
      conversationId,
      'Bonjour',
      agent,
      agentActor,
      undefined,
      null,
      { translatedFrom }
    )
    expect(result.message.translatedFrom).toEqual(translatedFrom)
  })

  it('never widens the shared (visitor-reachable) message event with translatedFrom', async () => {
    await sendAgentMessage(conversationId, 'Bonjour', agent, agentActor, undefined, null, {
      translatedFrom,
    })

    expect(publishConversationEvent).toHaveBeenCalledTimes(1)
    const [, sharedEvent] = publishConversationEvent.mock.calls[0] as [
      unknown,
      { kind: string; message: Record<string, unknown> },
    ]
    expect(sharedEvent.kind).toBe('message')
    expect(sharedEvent.message.translatedFrom).toBeUndefined()
  })

  it('broadcasts translatedFrom on an inbox-only message_updated event', async () => {
    await sendAgentMessage(conversationId, 'Bonjour', agent, agentActor, undefined, null, {
      translatedFrom,
    })

    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    const [inboxEvent] = publishAgentConversationEvent.mock.calls[0] as [
      { kind: string; message: Record<string, unknown> },
    ]
    expect(inboxEvent.kind).toBe('message_updated')
    expect(inboxEvent.message.translatedFrom).toEqual(translatedFrom)
  })

  it('does not fire the extra broadcast, and returns translatedFrom null, when the reply was not translated', async () => {
    const result = await sendAgentMessage(conversationId, 'Hi', agent, agentActor)
    expect(result.message.translatedFrom).toBeNull()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })
})
