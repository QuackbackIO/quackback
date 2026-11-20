/**
 * A rating tapped on a csat block while the conversation is open is refused,
 * and the refusal stores nothing: no visitor message carries the reply, so
 * the block is still unanswered. Once the conversation is closed, the same
 * tap stores the reply and records the rating.
 *
 * Real visitor send against Postgres (rolled back). Realtime, notifications,
 * webhooks and the assistant are stubbed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('@/lib/server/domains/conversation/conversation.notify', () => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', () => ({
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
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
  attributeCsatIfLastHandler: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  principal,
  settings,
  user,
  and,
  eq,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { ConflictError } from '@/lib/shared/errors'
import { CSAT_CONVERSATION_OPEN, sendVisitorMessage } from '../conversation.service'

const fixture = await createDbTestFixture()
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'user' | 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

let visitor: PrincipalId
let conversationId: ConversationId
let blockMessageId: ConversationMessageId

beforeEach(async () => {
  await fixture.begin()
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme_${suffix()}`, createdAt: new Date() })
  visitor = await seedPrincipal('user')
  const agent = await seedPrincipal('member')
  conversationId = createId('conversation') as ConversationId
  // Asked after a close, then reopened: the block is still unanswered.
  await testDb.insert(conversations).values({
    id: conversationId,
    visitorPrincipalId: visitor,
    channel: 'messenger',
    status: 'open',
  })
  const [block] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: agent,
      senderType: 'agent',
      content: 'How did we do?',
      metadata: {
        block: {
          v: 1,
          kind: 'csat',
          runId: 'run_test',
          nodeId: 'node_test',
          waiting: true,
          allowTypingInterrupt: true,
          commentPrompt: 'Anything else?',
        },
      },
    })
    .returning()
  blockMessageId = block.id as ConversationMessageId
})
afterEach(fixture.rollback)

function visitorActor(principalId: PrincipalId): Actor {
  return { principalId, role: 'user', principalType: 'user', segmentIds: new Set() } as Actor
}

function tap(rating: number) {
  return sendVisitorMessage(
    {
      conversationId,
      content: '',
      blockReply: { kind: 'csat', inReplyToMessageId: blockMessageId, rating },
    },
    { principalId: visitor, displayName: 'Visitor' },
    visitorActor(visitor)
  )
}

async function visitorMessages() {
  return testDb
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.senderType, 'visitor')
      )
    )
}

async function conversationRow() {
  const [row] = await testDb
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row
}

describe.skipIf(!fixture.available)('a csat block tapped on an open conversation', () => {
  it('is refused and stores nothing', async () => {
    const refusal = await tap(4).then(
      () => null,
      (err: unknown) => err
    )
    expect(refusal).toBeInstanceOf(ConflictError)
    expect((refusal as ConflictError).code).toBe(CSAT_CONVERSATION_OPEN)
    expect(await visitorMessages()).toEqual([])
    const row = await conversationRow()
    expect(row.csatRating).toBeNull()
    expect(row.status).toBe('open')
  })

  it('stays answerable: once closed, the same tap stores the reply and records the rating', async () => {
    await tap(4).catch(() => undefined)
    await testDb
      .update(conversations)
      .set({ status: 'closed', resolvedAt: new Date() })
      .where(eq(conversations.id, conversationId))

    await tap(4)

    const replies = await visitorMessages()
    expect(replies).toHaveLength(1)
    expect(replies[0].metadata?.blockReply).toMatchObject({
      kind: 'csat',
      inReplyToMessageId: blockMessageId,
      rating: 4,
    })
    const row = await conversationRow()
    expect(row.csatRating).toBe(4)
    expect(row.status).toBe('closed')
  })
})
