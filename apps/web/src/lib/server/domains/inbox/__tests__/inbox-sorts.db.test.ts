/**
 * Real-DB proof of the inbox sort orders over seeded timestamps (INB-24):
 * most recent, oldest, waiting longest and priority. The pure ordering
 * contracts live in conversation-query.test.ts (sortDescriptorFor) and the
 * cross-branch merge in inbox-merge.test.ts; this runs the actual query.
 * Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, user } from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationSort } from '@/lib/shared/conversation/views'
import { listConversationsForAgent } from '../../conversation/conversation.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const viewAll: Actor = {
  principalId: null,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set<PermissionKey>([PERMISSIONS.CONVERSATION_VIEW_ALL]),
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Sort visitor ${Date.now()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'anonymous', createdAt: new Date() })
  return principalId
}

describe.skipIf(!fixture.available)('inbox sorts (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('orders by recent, oldest, waiting longest and priority over seeded timestamps', async () => {
    const visitor = await seedVisitor()
    // a: newest activity, waiting the shortest, low priority
    // b: middle activity, waiting the longest, urgent
    // c: oldest activity, not waiting at all, high priority
    const rows = {
      a: { lastMessageAt: minutesAgo(1), waitingSince: minutesAgo(1), priority: 'low' as const },
      b: {
        lastMessageAt: minutesAgo(5),
        waitingSince: minutesAgo(30),
        priority: 'urgent' as const,
      },
      c: { lastMessageAt: minutesAgo(10), waitingSince: null, priority: 'high' as const },
    }
    const ids = {} as Record<keyof typeof rows, ConversationId>
    for (const [name, row] of Object.entries(rows) as [keyof typeof rows, (typeof rows)['a']][]) {
      ids[name] = createId('conversation') as ConversationId
      await testDb.insert(conversations).values({
        id: ids[name],
        visitorPrincipalId: visitor,
        channel: 'messenger',
        status: 'open',
        ...row,
      })
    }
    const order = async (sort: ConversationSort) => {
      const page = await listConversationsForAgent({ visitorPrincipalId: visitor, sort }, viewAll)
      const byId = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]))
      return page.conversations.map((c) => byId[c.id])
    }

    expect(await order('recent')).toEqual(['a', 'b', 'c'])
    expect(await order('oldest')).toEqual(['c', 'b', 'a'])
    // Longest waiting first; a thread nobody waits on sorts last.
    expect(await order('waiting')).toEqual(['b', 'a', 'c'])
    expect(await order('priority')).toEqual(['b', 'c', 'a'])
  })

  it('pages without duplicates or gaps, and a hidden conversation used as the cursor restarts at page one (INB-25)', async () => {
    const visitor = await seedVisitor()
    const otherAgentUser = createId('user') as UserId
    const otherAgent = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: otherAgentUser, name: 'Other agent' })
    await testDb.insert(principal).values({
      id: otherAgent,
      userId: otherAgentUser,
      role: 'member',
      type: 'user',
      createdAt: new Date(),
    })
    // Five threads in the scoped teammate's reach (no team, no assignee), one
    // assigned to someone else that the teammate cannot see.
    const visible: ConversationId[] = []
    for (let i = 0; i < 5; i++) {
      const id = createId('conversation') as ConversationId
      visible.push(id)
      await testDb.insert(conversations).values({
        id,
        visitorPrincipalId: visitor,
        channel: 'messenger',
        status: 'open',
        lastMessageAt: minutesAgo(i + 1),
      })
    }
    const hidden = createId('conversation') as ConversationId
    await testDb.insert(conversations).values({
      id: hidden,
      visitorPrincipalId: visitor,
      channel: 'messenger',
      status: 'open',
      assignedAgentPrincipalId: otherAgent,
      lastMessageAt: minutesAgo(3.5),
    })
    const scoped: Actor = {
      principalId: createId('principal') as PrincipalId,
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set<PermissionKey>([PERMISSIONS.CONVERSATION_VIEW]),
    }
    const list = (before?: string) =>
      listConversationsForAgent({ visitorPrincipalId: visitor, limit: 2, before }, scoped)

    const seen: string[] = []
    let page = await list()
    const first = page.conversations.map((c) => c.id)
    seen.push(...first)
    while (page.hasMore && page.nextCursor) {
      page = await list(page.nextCursor)
      seen.push(...page.conversations.map((c) => c.id))
    }
    expect(seen).toEqual(visible)

    const fromHidden = await list(hidden)
    expect(fromHidden.conversations.map((c) => c.id)).toEqual(first)
  })
})
