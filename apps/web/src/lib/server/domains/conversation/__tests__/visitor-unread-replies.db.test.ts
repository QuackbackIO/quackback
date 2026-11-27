/**
 * Real-DB coverage for listVisitorUnreadReplies, the reply preview above the
 * closed launcher: the newest unread agent replies of the conversation with
 * the newest one, oldest first, with that conversation's unread count. The
 * unread rule is the badge's (countVisitorUnreadMessages), so the card and
 * the badge agree. Runs inside the rollback fixture transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, conversationMessages, principal, user, eq } from '@/lib/server/db'
import { listVisitorUnreadReplies } from '../conversation.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'user' | 'member' = 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `P-${suffix()}` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: role === 'user' ? 'anonymous' : 'user',
    createdAt: new Date(),
  })
  return principalId
}

async function seedConversation(
  visitorPrincipalId: PrincipalId,
  visitorLastReadAt: Date | null = null
): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id, visitorPrincipalId, channel: 'messenger', visitorLastReadAt })
  return id
}

async function addMessage(
  conversationId: ConversationId,
  content: string,
  at: string,
  over: {
    senderType?: 'agent' | 'visitor' | 'system'
    isInternal?: boolean
    deletedAt?: Date | null
    principalId?: PrincipalId | null
    replyTime?: boolean
  } = {}
) {
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId,
      senderType: over.senderType ?? 'agent',
      isInternal: over.isInternal ?? false,
      principalId: over.principalId ?? null,
      content,
      createdAt: new Date(at),
      deletedAt: over.deletedAt ?? null,
      metadata: over.replyTime
        ? ({ block: { kind: 'replyTime', status: 'online' } } as never)
        : null,
    })
    .returning({ id: conversationMessages.id })
  return row.id
}

describe.skipIf(!fixture.available)('listVisitorUnreadReplies (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns null when nothing is unread', async () => {
    const visitor = await seedPrincipal()
    const c = await seedConversation(visitor, new Date('2026-11-20T12:00:00.000Z'))
    await addMessage(c, 'Read already', '2026-11-20T10:00:00.000Z')
    expect(await listVisitorUnreadReplies(visitor)).toBeNull()
  })

  it('takes the newest three unread replies of the newest conversation, oldest first', async () => {
    const visitor = await seedPrincipal()
    const agent = await seedPrincipal('member')
    const older = await seedConversation(visitor)
    await addMessage(older, 'Older thread', '2026-11-20T09:00:00.000Z')
    const c = await seedConversation(visitor, new Date('2026-11-20T10:00:00.000Z'))
    await addMessage(c, 'Before the read mark', '2026-11-20T09:30:00.000Z')
    await addMessage(c, 'One', '2026-11-20T10:01:00.000Z', { principalId: agent })
    await addMessage(c, 'Visitor', '2026-11-20T10:02:00.000Z', { senderType: 'visitor' })
    await addMessage(c, 'Two', '2026-11-20T10:03:00.000Z', { principalId: agent })
    await addMessage(c, 'Note', '2026-11-20T10:04:00.000Z', { isInternal: true })
    await addMessage(c, 'Gone', '2026-11-20T10:05:00.000Z', { deletedAt: new Date() })
    await addMessage(c, 'Three', '2026-11-20T10:06:00.000Z', { principalId: agent })
    const newestId = await addMessage(c, 'Four', '2026-11-20T10:07:00.000Z', {
      principalId: agent,
    })

    const result = await listVisitorUnreadReplies(visitor)
    expect(result).not.toBeNull()
    expect(result!.conversationId).toBe(c)
    expect(result!.count).toBe(4)
    expect(result!.messages.map((m) => m.content)).toEqual(['Two', 'Three', 'Four'])
    expect(result!.messages[2]).toMatchObject({ id: newestId, principalId: agent, cited: false })
    expect(result!.messages[2].createdAt).toBeInstanceOf(Date)
  })

  it('skips reply-time captions, which the thread never shows as bubbles', async () => {
    const visitor = await seedPrincipal()
    const c = await seedConversation(visitor)
    await addMessage(c, 'Hello there', '2026-11-20T10:00:00.000Z')
    await addMessage(c, 'We usually reply in minutes', '2026-11-20T10:01:00.000Z', {
      replyTime: true,
    })
    const result = await listVisitorUnreadReplies(visitor)
    expect(result!.messages.map((m) => m.content)).toEqual(['Hello there'])
    expect(result!.count).toBe(1)
  })

  it('marks a reply that cites sources', async () => {
    const visitor = await seedPrincipal()
    const c = await seedConversation(visitor)
    const id = await addMessage(c, 'See the guide [1]', '2026-11-20T10:00:00.000Z')
    await testDb
      .update(conversationMessages)
      .set({ citations: [{ title: 'Guide', url: 'https://example.com/guide' }] as never })
      .where(eq(conversationMessages.id, id))
    const result = await listVisitorUnreadReplies(visitor)
    expect(result!.messages[0].cited).toBe(true)
  })

  it('lists the newest unread replies across every conversation, oldest first, at most 20', async () => {
    const visitor = await seedPrincipal()
    const a = await seedConversation(visitor)
    const b = await seedConversation(visitor)
    const inA = await addMessage(a, 'In A', '2026-11-20T09:00:00.000Z')
    for (let i = 0; i < 21; i++) {
      await addMessage(b, `B ${i}`, new Date(Date.UTC(2026, 10, 20, 10, i)).toISOString())
    }
    const result = await listVisitorUnreadReplies(visitor)
    expect(result!.conversationId).toBe(b)
    expect(result!.recent).toHaveLength(20)
    expect(result!.recent[0].content).toBe('B 1')
    expect(result!.recent[19].content).toBe('B 20')
    expect(result!.recent.every((m) => m.conversationId === b)).toBe(true)
    expect(result!.recent.some((m) => m.id === inA)).toBe(false)

    // With fewer replies, each conversation's show side by side.
    const small = await seedPrincipal()
    const x = await seedConversation(small)
    const y = await seedConversation(small)
    await addMessage(x, 'X', '2026-11-20T10:00:00.000Z')
    await addMessage(y, 'Y', '2026-11-20T10:01:00.000Z')
    const both = await listVisitorUnreadReplies(small)
    expect(both!.conversationId).toBe(y)
    expect(both!.messages.map((m) => m.content)).toEqual(['Y'])
    expect(both!.recent.map((m) => [m.conversationId, m.content])).toEqual([
      [x, 'X'],
      [y, 'Y'],
    ])
  })

  it("never reads another visitor's conversations", async () => {
    const mine = await seedPrincipal()
    const other = await seedPrincipal()
    await addMessage(await seedConversation(other), 'Not yours', '2026-11-20T10:00:00.000Z')
    expect(await listVisitorUnreadReplies(mine)).toBeNull()
  })
})
