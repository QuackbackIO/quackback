/**
 * Service-level guards for conversation message sends: content validation, server-decided
 * sender type, and conversation creation on first message.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ValidationError, ForbiddenError } from '@/lib/shared/errors'

const insertedConversations: Record<string, unknown>[] = []
const insertedMessages: Record<string, unknown>[] = []
// The `.set()` payload of the post-insert conversation UPDATE — where the
// active-channel promotion is written.
const updatedConversations: Record<string, unknown>[] = []

// vi.mock factories are hoisted above imports, so build the spy bag via
// vi.hoisted so the factory below can close over it.
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
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))

// Auto-routing dynamically imports ./routing. Make it always hand back an agent
// so a new conversation gets claimed and the assigned webhook can fire.
vi.mock('../routing', () => ({
  routeConversation: vi.fn(async () => ({ assignedPrincipalId: 'principal_agent' })),
}))

// The visitor-send funnel guards on isBlocked; default to not-blocked and let
// individual tests override.
const blockingMock = vi.hoisted(() => ({ isBlocked: vi.fn(async () => false) }))
vi.mock('@/lib/server/domains/principals/blocking', () => blockingMock)

// config getters validate the full env (absent in tests); provide just what the
// attachment URL check reads.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../conversation.query', () => ({
  // Return shapes good enough for the service to map results; the service does
  // not branch on their contents in these tests.
  conversationToDTO: vi.fn(async (c: { id: string; status: string }) => ({
    id: c.id,
    status: c.status,
    subject: null,
    lastMessagePreview: null,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    visitor: { principalId: 'p', displayName: null, avatarUrl: null },
    assignedAgent: null,
    unreadCount: 0,
  })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderType: m.senderType,
    content: m.content,
    createdAt: new Date().toISOString(),
    author: { principalId: m.principalId, displayName: null, avatarUrl: null },
  })),
  authorFromInput: vi.fn((a: { principalId: string }) => ({
    principalId: a.principalId,
    displayName: null,
    avatarUrl: null,
  })),
  loadAuthors: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/server/db', () => {
  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = vi.fn((row: Record<string, unknown>) => {
      if (label === 'conversations') insertedConversations.push(row)
      if (label === 'conversation_messages') insertedMessages.push(row)
      return c
    })
    c.set = vi.fn((row: Record<string, unknown>) => {
      if (label === 'conversations') updatedConversations.push(row)
      return c
    })
    c.where = vi.fn(() => c)
    c.limit = vi.fn(async () => [])
    c.orderBy = vi.fn(() => c)
    c.returning = vi.fn(async () => {
      if (label === 'conversations') {
        const last = insertedConversations.at(-1) ?? {}
        return [
          {
            id: 'conversation_new' as unknown as ConversationId,
            visitorPrincipalId: last.visitorPrincipalId ?? 'principal_visitor',
            assignedAgentPrincipalId: null,
            status: last.status ?? 'open',
            subject: last.subject ?? null,
            lastMessagePreview: null,
            lastMessageAt: new Date(),
            visitorLastReadAt: null,
            agentLastReadAt: null,
            createdAt: new Date(),
            updatedAt: null,
          },
        ]
      }
      if (label === 'conversation_messages') {
        const last = insertedMessages.at(-1) ?? {}
        return [{ ...last, id: 'conversation_msg_new', createdAt: new Date() }]
      }
      return []
    })
    return c
  }

  const tx = {
    select: vi.fn(() => chain('select')),
    insert: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
    update: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
  }

  return {
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      select: vi.fn(() => chain('select')),
      update: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    conversationMessages: { __name: 'conversation_messages', id: 'id' },
    principal: { __name: 'principal', id: 'id', displayName: 'display_name' },
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
  insertedMessages.length = 0
  updatedConversations.length = 0
  vi.clearAllMocks()
})

// `conversations.channel` is the surface the thread is CURRENTLY on, not the one
// it arrived on. It follows the customer, because every channel-dependent
// delivery decision reads it — most importantly the presence gate in
// notifyAgentReply, which must not treat an email customer's mailbox as a side
// channel it can skip.
describe('sendVisitorMessage active-channel promotion', () => {
  // The send also issues a second conversation UPDATE for auto-routing, so match
  // on the payload that actually carries a channel rather than on call order.
  const channelWrites = () => updatedConversations.filter((u) => 'channel' in u)

  it('promotes the conversation to the email channel for a message sent over email', async () => {
    await sendVisitorMessage(
      { content: 'Replying from my inbox', metadata: { source: 'email' } },
      { principalId: visitor },
      visitorActor
    )

    expect(channelWrites()).toHaveLength(1)
    expect(channelWrites()[0].channel).toBe('email')
  })

  it('restores the messenger channel when the same customer answers in-product', async () => {
    await sendVisitorMessage(
      { content: 'back in the widget' },
      { principalId: visitor },
      visitorActor
    )

    // Deliberately bidirectional: a one-way latch would keep mailing someone who
    // has moved back into the widget, on top of the in-app message they can see.
    expect(channelWrites()).toHaveLength(1)
    expect(channelWrites()[0].channel).toBe('messenger')
  })
})

describe('sendVisitorMessage validation', () => {
  it('rejects empty / whitespace content before any DB write', async () => {
    await expect(
      sendVisitorMessage({ content: '   ' }, { principalId: visitor }, visitorActor)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedMessages).toHaveLength(0)
  })

  it('rejects content over the max length', async () => {
    const huge = 'x'.repeat(5000)
    await expect(
      sendVisitorMessage({ content: huge }, { principalId: visitor }, visitorActor)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedMessages).toHaveLength(0)
  })

  // Defense in depth: the shared visitor-send seam refuses a blocked visitor even
  // if a future ingress channel forgets its own pre-check. No message is written.
  it('refuses a blocked visitor at the shared seam', async () => {
    blockingMock.isBlocked.mockResolvedValueOnce(true)
    await expect(
      sendVisitorMessage({ content: 'Hello there' }, { principalId: visitor }, visitorActor)
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(insertedMessages).toHaveLength(0)
  })
})

describe('sendVisitorMessage first-message conversation creation', () => {
  it('creates an open conversation and a visitor-typed message', async () => {
    const result = await sendVisitorMessage(
      { content: 'Hello there' },
      { principalId: visitor },
      visitorActor
    )

    expect(result.created).toBe(true)
    expect(insertedConversations).toHaveLength(1)
    expect(insertedConversations[0]).toMatchObject({
      visitorPrincipalId: visitor,
      status: 'open',
    })
    expect(insertedMessages).toHaveLength(1)
    // Sender type is decided server-side, never trusted from the client.
    expect(insertedMessages[0]).toMatchObject({
      senderType: 'visitor',
      principalId: visitor,
      content: 'Hello there',
    })
  })

  it('emits conversation.created + message.created webhooks for a first message', async () => {
    await sendVisitorMessage({ content: 'Hello there' }, { principalId: visitor }, visitorActor)
    // Fire-and-forget after the commit: a created conversation gets both events.
    expect(emit.emitConversationCreated).toHaveBeenCalledTimes(1)
    expect(emit.emitMessageCreated).toHaveBeenCalledTimes(1)
  })

  it('emits conversation.assigned when a new conversation is auto-routed', async () => {
    await sendVisitorMessage({ content: 'Hello there' }, { principalId: visitor }, visitorActor)
    // Auto-routing claims the unassigned conversation, so the assigned webhook
    // fires with a system actor and no previous assignee.
    expect(emit.emitConversationAssigned).toHaveBeenCalledTimes(1)
    const [actor, , previousAgentPrincipalId] = emit.emitConversationAssigned.mock.calls[0]
    expect(actor).toMatchObject({ principalId: null, principalType: 'service' })
    expect(previousAgentPrincipalId).toBeNull()
  })
})

describe('sendVisitorMessage content derivation from contentJson', () => {
  it('derives content from a text-bearing contentJson when content is blank', async () => {
    const contentJson = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello from the doc.' }] }],
    }
    const result = await sendVisitorMessage(
      { content: '' },
      { principalId: visitor },
      visitorActor,
      contentJson
    )
    expect(result.created).toBe(true)
    expect(insertedMessages[0]).toMatchObject({ content: 'Hello from the doc.' })
  })

  it('clears an external inline-image src (visitor images are trusted-origin only)', async () => {
    const contentJson = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'see:' }] },
        {
          type: 'resizableImage',
          attrs: { src: 'https://evil.example.com/track.gif', alt: 'x' },
        },
        {
          type: 'chatImage',
          attrs: { src: '/api/storage/widget-images/mine.png', alt: 'ok' },
        },
      ],
    }
    const result = await sendVisitorMessage(
      { content: 'see:' },
      { principalId: visitor },
      visitorActor,
      contentJson
    )
    expect(result.created).toBe(true)
    const doc = insertedMessages[0].contentJson as {
      content?: { type: string; attrs?: Record<string, unknown> }[]
    }
    const resizable = doc.content?.find((n) => n.type === 'resizableImage')
    const chat = doc.content?.find((n) => n.type === 'chatImage')
    expect(resizable?.attrs?.src).toBe('')
    expect(chat?.attrs?.src).toBe('/api/storage/widget-images/mine.png')
  })
})

describe('sendVisitorMessage attachments', () => {
  it('allows an attachment-only message (empty content)', async () => {
    const result = await sendVisitorMessage(
      {
        content: '',
        attachments: [
          {
            url: '/api/storage/chat-images/x.png',
            name: 'x.png',
            contentType: 'image/png',
            size: 1234,
          },
        ],
      },
      { principalId: visitor },
      visitorActor
    )
    expect(result.created).toBe(true)
    expect(insertedMessages).toHaveLength(1)
    expect((insertedMessages[0].attachments as unknown[]) ?? []).toHaveLength(1)
  })

  it('rejects an attachment URL that is not from our storage', async () => {
    await expect(
      sendVisitorMessage(
        {
          content: 'hi',
          attachments: [
            {
              url: 'https://evil.example.com/x.png',
              name: 'x.png',
              contentType: 'image/png',
              size: 10,
            },
          ],
        },
        { principalId: visitor },
        visitorActor
      )
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedMessages).toHaveLength(0)
  })

  // Structural URL validation must reject substring-bypass attempts that an
  // includes('/api/storage/') check would have let through (stored-XSS vector).
  it.each([
    'javascript:alert(1)//api/storage/x',
    'https://evil.example.com/api/storage/pixel.gif',
    'https://localhost.evil.com/api/storage/x',
    'data:text/html,/api/storage/',
  ])('rejects bypass URL %s', async (badUrl) => {
    await expect(
      sendVisitorMessage(
        {
          content: 'hi',
          attachments: [{ url: badUrl, name: 'x', contentType: 'image/png', size: 10 }],
        },
        { principalId: visitor },
        visitorActor
      )
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedMessages).toHaveLength(0)
  })
})
