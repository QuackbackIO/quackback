/**
 * One rating ask per conversation: the signals every ask reads, and the
 * workflow csat block that posts only when none is present.
 *
 * Real DB (rolled back). Realtime, the webhook bridge and the assistant
 * runtime config are spied, so no fire-and-forget write races the fixture's
 * single connection. Concurrent asks are in csat-request-concurrency.db.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'

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
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', () => ({
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
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantRuntimeConfig: async () => ({
    config: { identity: { name: 'Assistant', avatarUrl: null } },
  }),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  emailLog,
  principal,
  user,
  and,
  eq,
  sql,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import {
  isConversationRated,
  isCsatAlreadyRequested,
  isCsatRatedOrEmailed,
} from '../csat-request.service'
import { applyAction } from '@/lib/server/domains/workflows/action.executor'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailLog.id }).from(emailLog).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedConversation(): Promise<{
  conversationId: ConversationId
  visitor: PrincipalId
}> {
  const userId = createId('user') as UserId
  const visitor = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: visitor, userId, role: 'user', type: 'user', createdAt: new Date() })
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: visitor, channel: 'messenger' })
  return { conversationId, visitor }
}

async function addBlock(
  conversationId: ConversationId,
  author: PrincipalId,
  kind: 'csat' | 'buttons',
  deleted = false
) {
  const base = { v: 1 as const, runId: 'run_x', nodeId: 'node_x', waiting: true }
  await testDb.insert(conversationMessages).values({
    conversationId,
    principalId: author,
    senderType: 'agent',
    content: 'Block',
    metadata: {
      block:
        kind === 'csat'
          ? { ...base, kind, allowTypingInterrupt: true, commentPrompt: 'Anything else?' }
          : { ...base, kind, options: [{ key: 'a', label: 'A' }], allowTyping: true },
    },
    deletedAt: deleted ? new Date() : null,
  })
}

async function addEmailLog(conversationId: ConversationId, emailType: string) {
  await testDb.insert(emailLog).values({
    direction: 'outbound',
    emailType,
    address: 'you@example.com',
    subject: 'Subject',
    status: 'sent',
    conversationId,
  })
}

async function csatBlockCount(conversationId: ConversationId) {
  const rows = await testDb
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        sql`${conversationMessages.metadata} -> 'block' ->> 'kind' = 'csat'`
      )
    )
  return rows.length
}

const serviceActor = { principalId: null, role: null, principalType: 'service' } as unknown as Actor

function askForRating(conversationId: ConversationId) {
  return applyAction(
    {
      type: 'send_block',
      nodeId: 'node_ask',
      block: {
        kind: 'csat',
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'How did we do?' }] }],
        },
        allowTypingInterrupt: true,
      },
    },
    { conversationId, actor: serviceActor, runId: 'run_ask' }
  )
}

describe.skipIf(!fixture.available)('csat ask signals', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('is not requested on a conversation with no signal', async () => {
    const { conversationId, visitor } = await seedConversation()
    // Signals that are not an ask: a buttons block, a deleted csat block, another email.
    await addBlock(conversationId, visitor, 'buttons')
    await addBlock(conversationId, visitor, 'csat', true)
    await addEmailLog(conversationId, 'ConversationClosedEmail')
    // An ask on another conversation.
    const other = await seedConversation()
    await addBlock(other.conversationId, other.visitor, 'csat')
    await addEmailLog(other.conversationId, 'CsatRequestEmail')

    expect(await isCsatAlreadyRequested(conversationId)).toBe(false)
  })

  it('is requested once a rating is on file', async () => {
    const { conversationId } = await seedConversation()
    await testDb
      .update(conversations)
      .set({ csatRating: 4, csatSubmittedAt: new Date() })
      .where(eq(conversations.id, conversationId))
    expect(await isCsatAlreadyRequested(conversationId)).toBe(true)
  })

  it('is requested once a csat block is in the thread', async () => {
    const { conversationId, visitor } = await seedConversation()
    await addBlock(conversationId, visitor, 'csat')
    expect(await isCsatAlreadyRequested(conversationId)).toBe(true)
  })

  it('is requested once a rating email was sent', async () => {
    const { conversationId } = await seedConversation()
    await addEmailLog(conversationId, 'CsatRequestEmail')
    expect(await isCsatAlreadyRequested(conversationId)).toBe(true)
  })
})

describe.skipIf(!fixture.available)('the close email and rating signals', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('ignores an unanswered csat block, which a visitor who left never saw', async () => {
    const { conversationId, visitor } = await seedConversation()
    await addBlock(conversationId, visitor, 'csat')
    expect(await isCsatAlreadyRequested(conversationId)).toBe(true)
    expect(await isCsatRatedOrEmailed(conversationId)).toBe(false)
    expect(await isConversationRated(conversationId)).toBe(false)
  })

  it('counts a rating and a rating email', async () => {
    const rated = await seedConversation()
    await testDb
      .update(conversations)
      .set({ csatRating: 4, csatSubmittedAt: new Date() })
      .where(eq(conversations.id, rated.conversationId))
    expect(await isCsatRatedOrEmailed(rated.conversationId)).toBe(true)
    expect(await isConversationRated(rated.conversationId)).toBe(true)

    const emailed = await seedConversation()
    await addEmailLog(emailed.conversationId, 'CsatRequestEmail')
    expect(await isCsatRatedOrEmailed(emailed.conversationId)).toBe(true)
    expect(await isConversationRated(emailed.conversationId)).toBe(false)
  })
})

describe.skipIf(!fixture.available)('a workflow csat block asks once', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('posts the first ask and skips the second', async () => {
    const { conversationId } = await seedConversation()

    const first = await askForRating(conversationId)
    expect(first.blockMessageId).toBeDefined()
    const second = await askForRating(conversationId)
    expect(second.blockMessageId).toBeUndefined()

    expect(await csatBlockCount(conversationId)).toBe(1)
  })

  it.each([
    ['a rating', 'rating'],
    ['a rating email', 'email'],
  ] as const)('skips a conversation that already has %s', async (_label, signal) => {
    const { conversationId } = await seedConversation()
    if (signal === 'rating') {
      await testDb
        .update(conversations)
        .set({ csatRating: 2, csatSubmittedAt: new Date() })
        .where(eq(conversations.id, conversationId))
    } else {
      await addEmailLog(conversationId, 'CsatRequestEmail')
    }

    const result = await askForRating(conversationId)

    expect(result.blockMessageId).toBeUndefined()
    expect(await csatBlockCount(conversationId)).toBe(0)
  })
})

describe.skipIf(!fixture.available)('a rating ask on a closed conversation', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  /** Close as a teammate would, an hour ago; returns the stored resolvedAt. */
  async function closeConversation(conversationId: ConversationId): Promise<Date | null> {
    const [row] = await testDb
      .update(conversations)
      .set({ status: 'closed', resolvedAt: new Date(Date.now() - 3_600_000) })
      .where(eq(conversations.id, conversationId))
      .returning({ resolvedAt: conversations.resolvedAt })
    return row.resolvedAt
  }

  async function readStatus(conversationId: ConversationId) {
    const [row] = await testDb
      .select({ status: conversations.status, resolvedAt: conversations.resolvedAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    return row
  }

  it('posts the ask and leaves the conversation closed', async () => {
    const { conversationId } = await seedConversation()
    const resolvedAt = await closeConversation(conversationId)

    const result = await askForRating(conversationId)

    expect(result.blockMessageId).toBeDefined()
    expect(await csatBlockCount(conversationId)).toBe(1)
    expect(await readStatus(conversationId)).toEqual({ status: 'closed', resolvedAt })
  })

  it('still reopens on another block, as any assistant reply does', async () => {
    const { conversationId } = await seedConversation()
    await closeConversation(conversationId)

    const result = await applyAction(
      {
        type: 'send_block',
        nodeId: 'node_buttons',
        block: {
          kind: 'buttons',
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pick one' }] }],
          },
          options: [{ key: 'a', label: 'A' }],
          allowTyping: true,
        },
      },
      { conversationId, actor: serviceActor, runId: 'run_buttons' }
    )

    expect(result.blockMessageId).toBeDefined()
    expect((await readStatus(conversationId))?.status).toBe('open')
  })
})
