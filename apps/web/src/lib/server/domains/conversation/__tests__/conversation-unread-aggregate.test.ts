/**
 * Real-DB coverage for countVisitorUnreadMessages — the messenger badge
 * aggregate. It must sum agent replies newer than each conversation's visitor
 * read watermark across ALL of a visitor's threads (the per-thread unreadCount
 * only covers one), count everything in a never-read thread, and ignore internal
 * notes, deleted rows, the visitor's own messages, system events, and other
 * visitors' conversations. Runs inside the rollback fixture transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

// Domain code imports the global `db`; rebind it to the test transaction.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, conversationMessages, principal, user } from '@/lib/server/db'
import {
  conversationToDTO,
  countVisitorUnreadMessages,
  summarizeVisitorUnreadReplies,
} from '../conversation.query'
import { eq, desc } from '@/lib/server/db'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'anonymous', createdAt: new Date() })
  return principalId
}

async function seedConversation(
  visitorPrincipalId: PrincipalId,
  visitorLastReadAt: Date | null
): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id, visitorPrincipalId, channel: 'messenger', visitorLastReadAt })
  return id
}

async function addMessage(
  conversationId: ConversationId,
  over: {
    senderType?: 'agent' | 'visitor' | 'system'
    isInternal?: boolean
    createdAt?: Date
    deletedAt?: Date | null
    replyTime?: boolean
  } = {}
) {
  await testDb.insert(conversationMessages).values({
    conversationId,
    senderType: over.senderType ?? 'agent',
    isInternal: over.isInternal ?? false,
    content: 'msg',
    createdAt: over.createdAt ?? new Date(),
    deletedAt: over.deletedAt ?? null,
    metadata: over.replyTime ? ({ block: { kind: 'replyTime', status: 'online' } } as never) : null,
  })
}

describe.skipIf(!fixture.available)('countVisitorUnreadMessages (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('sums unread agent replies across all of the visitor’s conversations', async () => {
    const visitor = await seedVisitor()
    const read = new Date('2026-07-04T09:00:00.000Z')
    // A: watermark set — 1 agent message before it (read), 2 after (unread).
    const a = await seedConversation(visitor, read)
    await addMessage(a, { createdAt: new Date('2026-07-04T08:00:00.000Z') })
    await addMessage(a, { createdAt: new Date('2026-07-04T10:00:00.000Z') })
    await addMessage(a, { createdAt: new Date('2026-07-04T11:00:00.000Z') })
    // B: never read (null watermark) — its lone agent message is unread.
    const b = await seedConversation(visitor, null)
    await addMessage(b, { createdAt: new Date('2026-07-04T12:00:00.000Z') })

    expect(await countVisitorUnreadMessages(visitor)).toBe(3)
  })

  it('ignores internal notes, deleted rows, own + system messages', async () => {
    const visitor = await seedVisitor()
    const c = await seedConversation(visitor, null) // never read: every eligible row would count
    await addMessage(c, { senderType: 'agent' }) // counts (1)
    await addMessage(c, { senderType: 'agent', isInternal: true }) // internal note
    await addMessage(c, { senderType: 'agent', deletedAt: new Date() }) // deleted
    await addMessage(c, { senderType: 'visitor' }) // the visitor's own
    await addMessage(c, { senderType: 'system' }) // system event
    expect(await countVisitorUnreadMessages(visitor)).toBe(1)
  })

  it('leaves out reply-time captions, as the reply preview does', async () => {
    const visitor = await seedVisitor()
    const c = await seedConversation(visitor, null)
    await addMessage(c, { senderType: 'agent' })
    await addMessage(c, { senderType: 'agent', replyTime: true })
    expect(await countVisitorUnreadMessages(visitor)).toBe(1)
  })

  it("agrees with the conversation's own visitor unread count", async () => {
    const visitor = await seedVisitor()
    const c = await seedConversation(visitor, null)
    await addMessage(c, { senderType: 'agent' })
    await addMessage(c, { senderType: 'agent' })
    await addMessage(c, { senderType: 'agent', replyTime: true })
    await addMessage(c, { senderType: 'agent', isInternal: true })
    await addMessage(c, { senderType: 'visitor' })
    const [row] = await testDb.select().from(conversations).where(eq(conversations.id, c))
    const dto = await conversationToDTO(row, 'visitor')
    expect(dto.unreadCount).toBe(2)
    expect(await countVisitorUnreadMessages(visitor)).toBe(dto.unreadCount)
  })

  it('names the newest unread reply by its TypeID, like every message id', async () => {
    const visitor = await seedVisitor()
    const c = await seedConversation(visitor, null)
    await addMessage(c, { createdAt: new Date('2026-07-04T10:00:00.000Z') })
    await addMessage(c, { createdAt: new Date('2026-07-04T11:00:00.000Z') })
    const [newest] = await testDb
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, c))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(1)
    const summary = await summarizeVisitorUnreadReplies(visitor)
    expect(summary.count).toBe(2)
    expect(summary.newestId).toMatch(/^conversation_msg_/)
    expect(summary.newestId).toBe(newest.id)
    expect(await summarizeVisitorUnreadReplies(await seedVisitor())).toEqual({
      count: 0,
      newestId: null,
    })
  })

  it('counts only the given visitor’s conversations', async () => {
    const mine = await seedVisitor()
    const other = await seedVisitor()
    await addMessage(await seedConversation(mine, null))
    await addMessage(await seedConversation(other, null))
    expect(await countVisitorUnreadMessages(mine)).toBe(1)
    expect(await countVisitorUnreadMessages(other)).toBe(1)
  })

  it('returns 0 for a visitor with no conversations', async () => {
    expect(await countVisitorUnreadMessages(await seedVisitor())).toBe(0)
  })
})
