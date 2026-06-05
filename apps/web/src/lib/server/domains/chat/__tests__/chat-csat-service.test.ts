/**
 * recordCsat webhook de-duplication: the widget submits CSAT as two unordered
 * POSTs (the rating, then an optional comment). The public
 * conversation.csat_submitted webhook must fire exactly once per survey — on
 * the first submission — so integrations don't double-count a rating when the
 * visitor also leaves a comment. The live inbox update, by contrast, still
 * fires on every call so the agent sees the comment land.
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
}))
vi.mock('../chat.webhooks', () => emit)

vi.mock('@/lib/server/realtime/chat-channels', () => ({
  publishChatEvent: vi.fn(),
  publishAgentChatEvent: vi.fn(),
  publishConversationUpdate: (...a: unknown[]) => publishConversationUpdate(...a),
}))

vi.mock('../chat.query', () => ({
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
    // recordCsat -> update().set().where().returning(): echo the current row so
    // conversationToDTO/emit receive a plausible post-update conversation.
    c.returning = async () => [{ ...conversationRow }]
    return c
  }
  return {
    db: { select: () => chain(), update: () => chain() },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
  }
})

import { recordCsat } from '../chat.service'

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

describe('recordCsat webhook de-duplication', () => {
  it('fires conversation.csat_submitted once across the rating-then-comment flow', async () => {
    // POST 1: initial rating, no comment.
    await recordCsat(convId, 5, undefined, visitorActor)
    // The first submission persists before the comment POST lands.
    conversationRow.csatRating = 5
    conversationRow.csatSubmittedAt = new Date()
    // POST 2: optional comment follow-up, same rating.
    await recordCsat(convId, 5, 'great support', visitorActor)

    expect(emit.emitConversationCsatSubmitted).toHaveBeenCalledTimes(1)
    // The live inbox update still fires on both calls so the comment shows up.
    expect(publishConversationUpdate).toHaveBeenCalledTimes(2)
  })

  it('fires once even when the comment POST lands before the rating POST', async () => {
    // POST 1 (out of order): comment + rating together.
    await recordCsat(convId, 4, 'thanks', visitorActor)
    conversationRow.csatRating = 4
    conversationRow.csatComment = 'thanks'
    conversationRow.csatSubmittedAt = new Date()
    // POST 2: the bare rating arrives late.
    await recordCsat(convId, 4, undefined, visitorActor)

    expect(emit.emitConversationCsatSubmitted).toHaveBeenCalledTimes(1)
  })
})
