/**
 * Recording a rating given in the thread is best-effort: when recordCsat
 * refuses the rating, the visitor's message still lands. The view policy is
 * replaced to deny, so the real recordCsat refuses a send the send policy
 * allows (the two agree in production, so a refusal there is rare).
 *
 * Real DB (rolled back). Realtime, the webhook bridge, notifications and the
 * assistant are spied, so no fire-and-forget write races the fixture's single
 * connection.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type ConversationMessageId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('../conversation.webhooks', () => ({
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageNoteCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageDeleted: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationAssigned: vi.fn().mockResolvedValue(undefined),
  emitConversationPriorityChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationCsatSubmitted: vi.fn().mockResolvedValue(undefined),
  emitConversationCsatCommentAdded: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
}))
const viewPolicy = vi.hoisted(() => ({ deny: false }))
vi.mock('@/lib/server/policy/conversation', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/policy/conversation')>()
  return {
    ...real,
    canViewConversation: (...args: Parameters<typeof real.canViewConversation>) =>
      viewPolicy.deny
        ? { allowed: false, reason: 'Denied for this test' }
        : real.canViewConversation(...args),
  }
})

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, conversationMessages, principal, user, eq } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { sendVisitorMessage } from '../conversation.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})
afterAll(() => fixture.close())

async function seed() {
  const userId = createId('user') as UserId
  const visitor = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Visitor' })
  await testDb
    .insert(principal)
    .values({ id: visitor, userId, role: 'user', type: 'user', createdAt: new Date() })
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: visitor, channel: 'messenger' })
  const [block] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: visitor,
      senderType: 'agent',
      content: 'How did we do?',
      metadata: {
        block: {
          v: 1,
          kind: 'csat',
          runId: 'run_x',
          nodeId: 'node_x',
          waiting: true,
          allowTypingInterrupt: true,
          commentPrompt: 'Anything else?',
        },
      },
    })
    .returning()
  return { visitor, conversationId, blockMessageId: block.id as ConversationMessageId }
}

describe.skipIf(!fixture.available)('a refused block rating', () => {
  beforeEach(fixture.begin)
  afterEach(() => {
    viewPolicy.deny = false
    return fixture.rollback()
  })

  it('still sends the message when the rating is refused', async () => {
    const { visitor, conversationId, blockMessageId } = await seed()
    const actor = {
      principalId: visitor,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
    } as Actor
    viewPolicy.deny = true

    const { message } = await sendVisitorMessage(
      {
        conversationId,
        content: '',
        blockReply: {
          kind: 'csat',
          inReplyToMessageId: blockMessageId,
          rating: 3,
          comment: 'Slow',
        },
      },
      { principalId: visitor, displayName: 'Visitor' },
      actor
    )

    const [stored] = await testDb
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, message.id as ConversationMessageId))
    expect(stored).toBeDefined()
    // The rating was refused, not recorded.
    const [conversation] = await testDb
      .select({ rating: conversations.csatRating })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect(conversation.rating).toBeNull()
  })
})
