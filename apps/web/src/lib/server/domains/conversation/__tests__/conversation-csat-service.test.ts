/**
 * recordCsat webhook emission: the widget submits CSAT as two unordered POSTs
 * (the rating, then an optional comment), so each public webhook fires once per
 * survey on the call that completes its meaning — conversation.csat_submitted on
 * the first submission (the rating), conversation.csat_comment_added when a
 * comment first lands. Integrations therefore never double-count a rating, and
 * the comment is still delivered as its own event. The live inbox update, by
 * contrast, fires on every call so the agent sees the comment land.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

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
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: (...a: unknown[]) => publishConversationUpdate(...a),
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn((a: { principalId: string }) => ({ principalId: a.principalId })),
  resolveAuthor: vi.fn(),
  loadAuthors: vi.fn(async () => new Map()),
}))

// Mutable pre-update conversation snapshot — tests flip csatRating between calls
// to simulate the first submission having persisted before the second lands.
const conversationRow: Record<string, unknown> = {
  id: 'conversation_1',
  visitorPrincipalId: 'principal_visitor',
  csatRating: null,
  csatComment: null,
  csatSubmittedAt: null,
}

vi.mock('@/lib/server/db', () => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.set = () => c
    c.where = () => c
    // loadConversationOr404 -> select().from().where().limit()
    c.limit = async () => [conversationRow]
    // recordCsat -> select(...).for('update'): the locked pre-update snapshot.
    c.for = async () => [conversationRow]
    // recordCsat -> update().set().where().returning(): echo the current row so
    // conversationToDTO/emit receive a plausible post-update conversation.
    c.returning = async () => [{ ...conversationRow }]
    return c
  }
  const tx = { select: () => chain(), update: () => chain() }
  return {
    db: {
      select: () => chain(),
      update: () => chain(),
      transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    conversations: {
      __name: 'conversations',
      id: 'id',
      csatRating: 'csat_rating',
      csatComment: 'csat_comment',
    },
  }
})

import { recordCsat } from '../conversation.service'

const convId = 'conversation_1' as ConversationId
const visitorActor: Actor = {
  principalId: 'principal_visitor' as PrincipalId,
  role: 'user',
  principalType: 'anonymous',
  segmentIds: new Set(),
}

beforeEach(() => {
  vi.clearAllMocks()
  conversationRow.csatRating = null
  conversationRow.csatComment = null
  conversationRow.csatSubmittedAt = null
})

describe('recordCsat webhook emission', () => {
  it('fires submitted once on the rating and comment_added once on the comment', async () => {
    // POST 1: initial rating, no comment.
    await recordCsat(convId, 5, undefined, visitorActor)
    // The first submission persists before the comment POST lands.
    conversationRow.csatRating = 5
    conversationRow.csatSubmittedAt = new Date()
    // POST 2: optional comment follow-up, same rating.
    await recordCsat(convId, 5, 'great support', visitorActor)

    expect(emit.emitConversationCsatSubmitted).toHaveBeenCalledTimes(1)
    expect(emit.emitConversationCsatCommentAdded).toHaveBeenCalledTimes(1)
    // The live inbox update still fires on both calls so the comment shows up.
    expect(publishConversationUpdate).toHaveBeenCalledTimes(2)
  })

  it('still fires each once when the comment POST lands before the rating POST', async () => {
    // POST 1 (out of order): comment + rating together.
    await recordCsat(convId, 4, 'thanks', visitorActor)
    conversationRow.csatRating = 4
    conversationRow.csatComment = 'thanks'
    conversationRow.csatSubmittedAt = new Date()
    // POST 2: the bare rating arrives late.
    await recordCsat(convId, 4, undefined, visitorActor)

    expect(emit.emitConversationCsatSubmitted).toHaveBeenCalledTimes(1)
    expect(emit.emitConversationCsatCommentAdded).toHaveBeenCalledTimes(1)
  })

  it('fires submitted but no comment event for a rating-only survey', async () => {
    await recordCsat(convId, 3, undefined, visitorActor)

    expect(emit.emitConversationCsatSubmitted).toHaveBeenCalledTimes(1)
    expect(emit.emitConversationCsatCommentAdded).not.toHaveBeenCalled()
  })
})
