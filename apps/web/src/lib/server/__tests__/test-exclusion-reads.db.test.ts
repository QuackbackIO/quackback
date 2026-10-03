/**
 * Reads that feed numbers, plan limits and other people's views leave a test
 * customer's ideas out, while the admin feedback inbox still shows them to the
 * team. A real idea carrying a legacy client `test` attribute always counts.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { and, boards, eq, posts, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))

import { loadUsageCounts } from '../domains/billing/usage-counts'
import { listBoardsWithDetails } from '../domains/boards/board.service'
import { listInboxPosts } from '../domains/posts/post.inbox'
import { postsVisibilityConditions } from '../domains/assistant/posts-retrieval'

const fixture = await createDbTestFixture()
let boardId: BoardId, testIdea: PostId, legacyIdea: PostId

describe.skipIf(!fixture.available)('reads leave test ideas out (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    const owner = createId('principal') as PrincipalId
    const customer = createId('principal') as PrincipalId
    const visitor = createId('principal') as PrincipalId
    const uid = createId('user') as UserId
    await testDb.insert(user).values({ id: uid, name: 'Acme' })
    await testDb.insert(principal).values([
      { id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() },
      { id: visitor, role: 'user', type: 'anonymous', createdAt: new Date() },
    ])
    await testDb.insert(principal).values({
      id: customer,
      role: 'user',
      type: 'anonymous',
      testOwnerPrincipalId: owner,
      createdAt: new Date(),
    })
    boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, name: 'Acme', slug: String(boardId) })
    testIdea = createId('post') as PostId
    legacyIdea = createId('post') as PostId
    await testDb.insert(posts).values([
      { id: testIdea, boardId, title: 'Acme test idea', content: '', principalId: customer },
      {
        id: legacyIdea,
        boardId,
        title: 'Acme legacy idea',
        content: '',
        principalId: visitor,
        widgetMetadata: { test: 'true' },
      },
    ])
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts real ideas only toward the plan limit', async () => {
    const before = (await loadUsageCounts()).maxPosts
    const [test] = await testDb.select().from(posts).where(eq(posts.id, testIdea))
    const [legacy] = await testDb.select().from(posts).where(eq(posts.id, legacyIdea))
    await testDb.insert(posts).values([
      { boardId, title: 'Acme second test idea', content: '', principalId: test.principalId },
      { boardId, title: 'Acme second real idea', content: '', principalId: legacy.principalId },
    ])
    expect((await loadUsageCounts()).maxPosts).toBe(before + 1)
  })

  it('counts real ideas only on the board list', async () => {
    const board = (await listBoardsWithDetails()).find((row) => row.id === boardId)
    expect(board?.postCount).toBe(1)
  })

  it('shows test ideas in the team inbox but not to API, MCP and Copilot reads', async () => {
    const team = await listInboxPosts({ boardIds: [boardId], limit: 50 })
    expect(team.items.map((item) => item.id).sort()).toEqual([testIdea, legacyIdea].sort())
    const external = await listInboxPosts({ boardIds: [boardId], excludeTest: true, limit: 50 })
    expect(external.items.map((item) => item.id)).toEqual([legacyIdea])
  })

  it('never lets Quinn or Copilot cite a test idea', async () => {
    for (const ceiling of ['public', 'team'] as const) {
      const rows = await testDb
        .select({ id: posts.id })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .where(and(...postsVisibilityConditions(ceiling)))
      const ids = rows.map((row) => row.id)
      expect(ids).not.toContain(testIdea)
      if (ceiling === 'team') expect(ids).toContain(legacyIdea)
    }
  })
})
