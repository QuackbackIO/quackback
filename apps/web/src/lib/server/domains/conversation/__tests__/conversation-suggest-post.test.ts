/**
 * suggestPost: an AGENT-ONLY nudge to track a RESOLVED conversation as a feedback
 * post. It is persisted as an INTERNAL note (isInternal=true) carrying the
 * suggestion under metadata.postSuggestion, and broadcast on the inbox channel
 * ONLY (publishAgentConversationEvent) — it must NEVER reach the visitor's conversation
 * channel, and is rejected unless the conversation is resolved (closed).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId, BoardId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

const insertedMessages: Record<string, unknown>[] = []
const publishConversationEvent = vi.fn()
const publishConversationUpdate = vi.fn()
const publishAgentConversationEvent = vi.fn()

// Mutable state the db mock reads: the conversation status drives the
// resolved-gate, so one mock serves both the rejected and accepted cases.
const mocks = vi.hoisted(() => ({
  state: { conversationStatus: 'open' as 'open' | 'pending' | 'closed' },
}))

vi.mock('../conversation.webhooks', () => ({
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

vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  findSimilarPostsByText: vi.fn(async () => []),
}))

vi.mock('../conversation.convert', () => ({
  createPostFromConversation: vi.fn(),
}))

vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn(async () => {}),
  cancelScheduledDispatch: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: (...args: unknown[]) => publishConversationEvent(...args),
  publishAgentConversationEvent: (...args: unknown[]) => publishAgentConversationEvent(...args),
  publishConversationUpdate: (...args: unknown[]) => publishConversationUpdate(...args),
}))

vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  addVoteOnBehalf: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// Project just the fields the assertions read. suggestPost now routes its
// broadcast through the SHARED enrichMessageForAgent path, which threads the
// in-memory postSuggestion straight onto the base DTO (no metadata re-read) and
// adds the empty reactions/flags a fresh note has.
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
    isInternal: m.isInternal,
    author: { principalId: m.principalId, displayName: null, avatarUrl: null },
  })),
  enrichMessageForAgent: vi.fn(
    async (m: Record<string, unknown>, _viewer: string, postSuggestion: unknown = null) => ({
      ...m,
      reactions: [],
      flaggedAt: null,
      postSuggestion: postSuggestion ?? null,
    })
  ),
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
  function conversationRow() {
    return {
      id: 'conversation_1' as unknown as ConversationId,
      visitorPrincipalId: 'principal_visitor',
      assignedAgentPrincipalId: null,
      status: mocks.state.conversationStatus,
      subject: null,
      lastMessagePreview: null,
      lastMessageAt: new Date(),
      visitorLastReadAt: null,
      agentLastReadAt: null,
      createdAt: new Date(),
      updatedAt: null,
    }
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
    c.limit = vi.fn(async () => [conversationRow()])
    c.orderBy = vi.fn(() => c)
    c.returning = vi.fn(async () => {
      if (label === 'conversation_messages') {
        const last = insertedMessages.at(-1) ?? {}
        return [{ ...last, id: 'conversation_msg_note', createdAt: new Date() }]
      }
      return [conversationRow()]
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
    principal: { __name: 'principal', id: 'id', role: 'role', type: 'type' },
    posts: { __name: 'posts', id: 'id', voteCount: 'vote_count' },
  }
})

import { suggestPost } from '../conversation.cards'

const conversationId = 'conversation_1' as ConversationId
const boardId = 'board_1' as BoardId
const agentPrincipalId = 'principal_agent' as PrincipalId
const agent = { principalId: agentPrincipalId, displayName: 'Jane', email: null }
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
  mocks.state.conversationStatus = 'open'
})

describe('suggestPost', () => {
  it('rejects a conversation that is not yet resolved, writing nothing', async () => {
    mocks.state.conversationStatus = 'open'
    await expect(
      suggestPost(
        { conversationId, boardId, title: 'Add dark mode', content: 'wants a night theme' },
        { agentActor, agentPrincipalId, agent }
      )
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedMessages).toHaveLength(0)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('rejects a pending conversation too (only closed is resolved)', async () => {
    mocks.state.conversationStatus = 'pending'
    await expect(
      suggestPost(
        { conversationId, boardId, title: 'Add dark mode', content: 'x' },
        { agentActor, agentPrincipalId, agent }
      )
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedMessages).toHaveLength(0)
  })

  it('inserts an agent-only internal note carrying the suggestion when resolved', async () => {
    mocks.state.conversationStatus = 'closed'

    const res = await suggestPost(
      { conversationId, boardId, title: 'Add dark mode', content: 'wants a night theme' },
      { agentActor, agentPrincipalId, agent }
    )

    expect(res.messageId).toBe('conversation_msg_note')

    // The persisted row is an agent-authored INTERNAL note (never sent to the
    // visitor) carrying the suggestion payload under metadata.postSuggestion.
    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0]).toMatchObject({
      conversationId,
      principalId: agentPrincipalId,
      senderType: 'agent',
      isInternal: true,
      metadata: {
        postSuggestion: { boardId, title: 'Add dark mode', content: 'wants a night theme' },
      },
    })
    // Human-readable note body references the title.
    expect(insertedMessages[0].content).toContain('Add dark mode')
  })

  it('broadcasts ONLY on the agent inbox channel — never the visitor channel', async () => {
    mocks.state.conversationStatus = 'closed'

    await suggestPost(
      { conversationId, boardId, title: 'Add dark mode', content: 'wants a night theme' },
      { agentActor, agentPrincipalId, agent }
    )

    // Inbox-only fan-out (publishAgentConversationEvent); the visitor-facing
    // publishConversationEvent / publishConversationUpdate are never touched.
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishConversationEvent).not.toHaveBeenCalled()
    expect(publishConversationUpdate).not.toHaveBeenCalled()

    // The agent-only broadcast carries the suggestion so the inbox can render the
    // chip in realtime.
    const [event] = publishAgentConversationEvent.mock.calls[0]
    expect(event).toMatchObject({
      kind: 'message',
      conversationId,
      message: {
        isInternal: true,
        postSuggestion: { boardId, title: 'Add dark mode', content: 'wants a night theme' },
      },
    })
  })

  it('refuses a non-agent actor before any write', async () => {
    mocks.state.conversationStatus = 'closed'
    await expect(
      suggestPost(
        { conversationId, boardId, title: 'Add dark mode', content: 'x' },
        { agentActor: visitorActor, agentPrincipalId, agent }
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(insertedMessages).toHaveLength(0)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })
})
