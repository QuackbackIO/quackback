/**
 * Typing/read side derivation: the side must follow the actor's relationship
 * to the CONVERSATION, not their global role. A team member chatting in a
 * thread they own (their own portal/widget conversation) is the visitor there
 * — otherwise their own typing echoes back as "agent is typing" and their
 * read-marks stamp the wrong watermark.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const publish = vi.hoisted(() => ({
  publishChatEvent: vi.fn(),
  publishAgentChatEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/chat-channels', () => publish)

vi.mock('../chat.webhooks', () => ({
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

vi.mock('../chat.notify', () => ({
  notifyVisitorMessage: vi.fn(async () => {}),
  notifyAgentReply: vi.fn(async () => {}),
  notifyConversationStarted: vi.fn(async () => {}),
}))

vi.mock('../routing', () => ({
  routeConversation: vi.fn(async () => null),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../chat.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn((a: Record<string, unknown>) => a),
  resolveAuthor: vi.fn(async (a: Record<string, unknown>) => a),
  loadAuthors: vi.fn(async () => new Map()),
}))

// The conversation's owner is configurable per test; updates record their
// .set payloads so the watermark choice is assertable.
const mocks = vi.hoisted(() => ({
  state: { visitorPrincipalId: 'principal_owner' as string },
  updateSets: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/server/db', () => {
  function conversationRow() {
    return {
      id: 'conversation_1',
      visitorPrincipalId: mocks.state.visitorPrincipalId,
      assignedAgentPrincipalId: null,
      status: 'open',
      subject: null,
      lastMessagePreview: null,
      lastMessageAt: new Date(),
      visitorLastReadAt: null,
      agentLastReadAt: null,
      visitorEmail: null,
      createdAt: new Date(),
      updatedAt: null,
    }
  }
  function chain() {
    const c: Record<string, unknown> = {}
    c.values = vi.fn(() => c)
    c.set = vi.fn((payload: Record<string, unknown>) => {
      mocks.updateSets.push(payload)
      return c
    })
    c.from = vi.fn(() => c)
    c.leftJoin = vi.fn(() => c)
    c.where = vi.fn(() => {
      const p = Promise.resolve([conversationRow()])
      return Object.assign(p, c)
    })
    c.orderBy = vi.fn(() => c)
    c.limit = vi.fn(async () => [conversationRow()])
    c.returning = vi.fn(async () => [conversationRow()])
    return c
  }
  return {
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(chain())),
      select: vi.fn(() => chain()),
      insert: vi.fn(() => chain()),
      update: vi.fn(() => chain()),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    inArray: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    chatMessages: { __name: 'chat_messages', id: 'id' },
    principal: { __name: 'principal', id: 'id' },
    user: { __name: 'user', id: 'id' },
  }
})

import { signalTyping, markConversationRead } from '../chat.service'

const conversationId = 'conversation_1' as ConversationId
const owner = 'principal_owner' as PrincipalId
const teamActor = (principalId: string): Actor => ({
  principalId: principalId as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
})
const userActor: Actor = {
  principalId: owner,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateSets.length = 0
  mocks.state.visitorPrincipalId = 'principal_owner'
})

describe('signalTyping side derivation', () => {
  it('a team member typing in SOMEONE ELSE’s conversation signals the agent side', async () => {
    await signalTyping(conversationId, teamActor('principal_agent'))
    expect(publish.publishTyping).toHaveBeenCalledWith(
      conversationId,
      'agent',
      expect.any(String),
      'principal_agent'
    )
  })

  it('a team member typing in THEIR OWN conversation signals the visitor side with their id', async () => {
    await signalTyping(conversationId, teamActor('principal_owner'))
    expect(publish.publishTyping).toHaveBeenCalledWith(
      conversationId,
      'visitor',
      expect.any(String),
      'principal_owner'
    )
  })

  it('a portal user typing in their own conversation signals the visitor side with their id', async () => {
    await signalTyping(conversationId, userActor)
    expect(publish.publishTyping).toHaveBeenCalledWith(
      conversationId,
      'visitor',
      expect.any(String),
      'principal_owner'
    )
  })
})

describe('markConversationRead side derivation', () => {
  it('a team member reading SOMEONE ELSE’s conversation stamps the agent watermark', async () => {
    await markConversationRead(conversationId, teamActor('principal_agent'))
    expect(mocks.updateSets.at(-1)).toHaveProperty('agentLastReadAt')
    expect(publish.publishChatEvent).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ kind: 'read', side: 'agent' })
    )
  })

  it('a team member reading THEIR OWN conversation stamps the visitor watermark', async () => {
    await markConversationRead(conversationId, teamActor('principal_owner'))
    expect(mocks.updateSets.at(-1)).toHaveProperty('visitorLastReadAt')
    expect(publish.publishChatEvent).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ kind: 'read', side: 'visitor' })
    )
  })
})
