/**
 * Post-in-chat sends: sharePost sends an embed-only agent message whose
 * contentJson is a quackbackEmbed of the post. It routes through sendAgentMessage
 * (server-decided 'agent' sender, conversation touch, realtime broadcast); the
 * empty text is valid because the doc carries the embed node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId, PostId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ForbiddenError } from '@/lib/shared/errors'

const insertedMessages: Record<string, unknown>[] = []
const publishChatEvent = vi.fn()
const publishConversationUpdate = vi.fn()

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
vi.mock('../chat.webhooks', () => emit)

vi.mock('@/lib/server/realtime/chat-channels', () => ({
  publishChatEvent: (...args: unknown[]) => publishChatEvent(...args),
  publishAgentChatEvent: vi.fn(),
  publishConversationUpdate: (...args: unknown[]) => publishConversationUpdate(...args),
}))

// The embed message routes through sendAgentMessage, which fires a (fire-and-
// forget) reply notification — stub it so no real notify pipeline runs.
vi.mock('../chat.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../chat.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string; status: string }) => ({
    id: c.id,
    status: c.status,
  })),
  // Project the fields the assertions read: server-decided senderType and the
  // rich doc (mirrors the real toMessageDTO).
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
  authorFromInput: vi.fn((a: { principalId: string }) => ({
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
      if (label === 'chat_messages') insertedMessages.push(row)
      return c
    })
    c.set = vi.fn(() => c)
    c.from = vi.fn(() => c)
    c.where = vi.fn(() => c)
    c.limit = vi.fn(async () => [conversationRow])
    c.orderBy = vi.fn(() => c)
    c.returning = vi.fn(async () => {
      if (label === 'chat_messages') {
        const last = insertedMessages.at(-1) ?? {}
        return [{ ...last, id: 'chat_msg_new', createdAt: new Date() }]
      }
      if (label === 'conversations') {
        return [{ ...conversationRow }]
      }
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
    chatMessages: { __name: 'chat_messages', id: 'id' },
  }
})

import { postEmbedDoc, sharePost } from '../chat.cards'

const conversationId = 'conversation_1' as ConversationId
const postId = 'post_1' as PostId
const agentPrincipalId = 'principal_agent' as PrincipalId
const agent = {
  principalId: agentPrincipalId,
  displayName: 'Jane',
  email: null,
}
const agentActor: Actor = {
  principalId: agentPrincipalId,
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

/** Find the quackbackEmbed node in a sanitized doc, if any. */
function embedNode(doc: unknown): { type: string; attrs?: Record<string, unknown> } | undefined {
  const content = (
    doc as { content?: Array<{ type: string; attrs?: Record<string, unknown> }> } | null
  )?.content
  return content?.find((n) => n.type === 'quackbackEmbed')
}

describe('postEmbedDoc', () => {
  it('builds a post embed doc', () => {
    const doc = postEmbedDoc('post_1' as PostId)
    const node = embedNode(doc)
    expect(node).toBeTruthy()
    expect(node?.attrs).toMatchObject({ kind: 'post', id: 'post_1' })
  })
})

describe('sharePost', () => {
  it('sends an embed-only agent message carrying a quackbackEmbed post node', async () => {
    const shared = await sharePost(
      { conversationId, postId },
      { agentActor, agentPrincipalId, agent }
    )
    expect(shared.message.senderType).toBe('agent')
    // The broadcast DTO carries the embed doc, not a card.
    expect(embedNode(shared.message.contentJson)).toBeTruthy()
    // The persisted row is an empty-text agent message whose contentJson embeds
    // the post.
    expect(insertedMessages[0]).toMatchObject({ senderType: 'agent', content: '' })
    expect(embedNode(insertedMessages[0].contentJson)).toBeTruthy()
  })

  it('refuses a non-agent actor before any write', async () => {
    await expect(
      sharePost({ conversationId, postId }, { agentActor: visitorActor, agentPrincipalId, agent })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(insertedMessages).toHaveLength(0)
  })
})
