import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, session, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { ANON_POST_RATE_LIMIT, checkAnonPostRateLimit } from '../anon-rate-limit'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id }).from(posts).limit(0)
  },
})

let board: BoardId
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  const [created] = await testDb
    .insert(boards)
    .values({ name: 'Ideas', slug: `ideas-${createId('board').slice(-6)}` })
    .returning()
  board = created!.id as BoardId
})
afterEach(fixture.rollback)
afterAll(fixture.close)

/** A visitor: their principal plus a session from `ip`. */
async function visitor(type: 'anonymous' | 'user', ip: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Visitor', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type, createdAt: new Date() })
  await testDb.insert(session).values({
    id: createId('user'),
    token: createId('user'),
    userId,
    ipAddress: ip,
    scope: 'portal',
    expiresAt: new Date(Date.now() + 86_400_000),
    updatedAt: new Date(),
  })
  return principalId
}

async function ideas(principalId: PrincipalId, count: number, createdAt = new Date()) {
  for (let i = 0; i < count; i++) {
    await testDb
      .insert(posts)
      .values({ boardId: board, principalId, title: `Idea ${i}`, content: 'x', createdAt })
  }
}

it('stops anonymous ideas from one address once the hourly limit is reached', async () => {
  const first = await visitor('anonymous', '203.0.113.7')
  const second = await visitor('anonymous', '203.0.113.7')
  await ideas(first, ANON_POST_RATE_LIMIT - 1)
  expect(await checkAnonPostRateLimit('203.0.113.7')).toBe(true)
  // A fresh anonymous identity from the same address shares the budget.
  await ideas(second, 1)
  expect(await checkAnonPostRateLimit('203.0.113.7')).toBe(false)
  expect(await checkAnonPostRateLimit('198.51.100.4')).toBe(true)
})

it('counts neither older ideas nor ideas from signed-in people', async () => {
  const anonymous = await visitor('anonymous', '203.0.113.9')
  const member = await visitor('user', '203.0.113.9')
  await ideas(anonymous, ANON_POST_RATE_LIMIT, new Date(Date.now() - 2 * 3_600_000))
  await ideas(member, ANON_POST_RATE_LIMIT)
  expect(await checkAnonPostRateLimit('203.0.113.9')).toBe(true)
})
