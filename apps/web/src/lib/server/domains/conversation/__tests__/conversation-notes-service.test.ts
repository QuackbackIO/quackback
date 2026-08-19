/**
 * Security-critical guards for internal notes: they are agent-only and must
 * never reach the visitor. We assert the note is written with isInternal=true,
 * published ONLY to the agent inbox channel (never the visitor's conversation
 * channel), and refused for non-agent actors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

const insertedMessages: Record<string, unknown>[] = []
const publishConversationEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()
const syncConversationMessageMentions = vi.fn()

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
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('../conversation.webhooks', () => emit)

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: (...args: unknown[]) => publishConversationEvent(...args),
  publishAgentConversationEvent: (...args: unknown[]) => publishAgentConversationEvent(...args),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
}))

vi.mock('../sync-conversation-mentions', () => ({
  syncConversationMessageMentions: (...args: unknown[]) => syncConversationMessageMentions(...args),
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
    isInternal: m.isInternal,
    content: m.content,
    author: { principalId: m.principalId, displayName: null, avatarUrl: null },
  })),
  authorFromInput: vi.fn((a: { principalId: string }) => ({
    principalId: a.principalId,
    displayName: null,
    avatarUrl: null,
  })),
  resolveAuthor: vi.fn(async (a: { principalId: string }) => ({
    principalId: a.principalId,
    displayName: null,
    avatarUrl: null,
  })),
  loadAuthors: vi.fn(async () => new Map()),
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
    // loadConversationOr404 resolves to an existing conversation.
    c.limit = vi.fn(async () => [conversationRow])
    c.orderBy = vi.fn(() => c)
    c.returning = vi.fn(async () => {
      if (label === 'conversation_messages') {
        const last = insertedMessages.at(-1) ?? {}
        return [{ ...last, id: 'conversation_msg_new', createdAt: new Date() }]
      }
      return []
    })
    return c
  }

  const tx = {
    insert: (table: { __name?: string }) => chain(table?.__name ?? 'unknown'),
    update: (table: { __name?: string }) => chain(table?.__name ?? 'unknown'),
  }

  return {
    db: {
      select: vi.fn(() => chain('select')),
      insert: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
      update: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
    eq: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    conversationMessages: { __name: 'conversation_messages', id: 'id', isInternal: 'is_internal' },
  }
})

import { addAgentNote } from '../conversation.service'

const conversationId = 'conversation_1' as ConversationId
const agent = {
  principalId: 'principal_agent' as PrincipalId,
  displayName: 'Jane',
  avatarUrl: null,
}
const agentActor: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}
const visitorActor: Actor = {
  principalId: 'principal_visitor' as PrincipalId,
  role: 'user',
  principalType: 'anonymous',
  segmentIds: new Set(),
}

beforeEach(() => {
  insertedMessages.length = 0
  vi.clearAllMocks()
})

describe('addAgentNote', () => {
  it('writes an internal, agent-typed message', async () => {
    await addAgentNote(conversationId, 'check the logs', agent, agentActor)
    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0]).toMatchObject({
      conversationId,
      principalId: agent.principalId,
      senderType: 'agent',
      isInternal: true,
      content: 'check the logs',
    })
  })

  it('publishes ONLY to the agent inbox, never the visitor conversation channel', async () => {
    await addAgentNote(conversationId, 'internal', agent, agentActor)
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    // The visitor's conversation channel must never receive an internal note.
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('emits the note_created webhook, not the public message_created one', async () => {
    await addAgentNote(conversationId, 'internal', agent, agentActor)
    expect(emit.emitMessageNoteCreated).toHaveBeenCalledTimes(1)
    // A note is internal: the public message.created webhook must never fire.
    expect(emit.emitMessageCreated).not.toHaveBeenCalled()
  })

  it('extracts @mentions from the note doc and hands the principal ids to the sync', async () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ping ' },
            { type: 'mention', attrs: { id: 'principal_p1', label: 'Pat' } },
          ],
        },
      ],
    }
    await addAgentNote(conversationId, 'ping @Pat', agent, agentActor, doc)
    expect(syncConversationMessageMentions).toHaveBeenCalledTimes(1)
    const arg = syncConversationMessageMentions.mock.calls[0][0] as {
      conversationMessageId: string
      conversationId: string
      mentionedIds: Set<string>
      authorPrincipalId: string
    }
    expect(arg.mentionedIds).toEqual(new Set(['principal_p1']))
    expect(arg.conversationMessageId).toBe('conversation_msg_new')
    expect(arg.conversationId).toBe(conversationId)
    expect(arg.authorPrincipalId).toBe(agent.principalId)
  })

  it('persists mentions BEFORE announcing the note (so a teammate refetch sees them)', async () => {
    // The inbox event triggers a Mentions-view refetch on every agent; if the
    // mention rows aren't written yet that refetch misses the new mention until
    // the next poll. Persist first, then publish.
    await addAgentNote(conversationId, 'ping', agent, agentActor, {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    expect(syncConversationMessageMentions).toHaveBeenCalled()
    expect(publishAgentConversationEvent).toHaveBeenCalled()
    expect(syncConversationMessageMentions.mock.invocationCallOrder[0]).toBeLessThan(
      publishAgentConversationEvent.mock.invocationCallOrder[0]
    )
  })

  it('persists the note rich doc as contentJson', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
    await addAgentNote(conversationId, 'hi', agent, agentActor, doc)
    expect(insertedMessages[0]).toMatchObject({ isInternal: true, contentJson: doc })
  })

  it('sanitizes the note doc before storing it (strips disallowed nodes)', async () => {
    // Notes are the one TipTap-doc write path; like comments/posts it must run
    // the Layer-1 sanitizer so a tampered client can't store hostile nodes.
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        { type: 'evilCustomNode', attrs: { onclick: 'steal()' } },
      ],
    }
    await addAgentNote(conversationId, 'hi', agent, agentActor, doc)
    const stored = insertedMessages[0].contentJson as { content: { type: string }[] }
    expect(stored.content.some((n) => n.type === 'evilCustomNode')).toBe(false)
  })

  it('refuses a non-agent actor before any write', async () => {
    await expect(
      addAgentNote(conversationId, 'sneaky', agent, visitorActor)
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(insertedMessages).toHaveLength(0)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('rejects empty content before any write', async () => {
    await expect(addAgentNote(conversationId, '   ', agent, agentActor)).rejects.toBeInstanceOf(
      ValidationError
    )
    expect(insertedMessages).toHaveLength(0)
  })
})
