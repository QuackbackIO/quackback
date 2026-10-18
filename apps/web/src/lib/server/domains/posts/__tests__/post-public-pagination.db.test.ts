/**
 * Real-DB coverage for portal feed pagination under sort ties (PRO-1664).
 *
 * The feed pages by OFFSET, and its first page comes from one query
 * (listPublicPostsWithVotesAndAvatars, the SSR portal payload) while later
 * pages come from another (listPublicPosts). Offset pages are only stable
 * under a total order: when posts tie on the sort key — identical created_at
 * from a bulk import, the common 1-vote post under "top" — Postgres may
 * order the tie differently per query, so a post straddling a page boundary
 * is served twice and its neighbour never. The post id (time-ordered) must
 * break every tie.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicPosts, listPublicPostsWithVotesAndAvatars } from '../post.public'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const PAGE = 20
const TOTAL = 45 // three pages, the last one short

async function seedTiedBoard(): Promise<{ slug: string; ids: PostId[] }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Tie Author' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Tie Author',
    createdAt: new Date(),
  })
  const slug = `ties-${suffix()}`
  const [board] = await testDb
    .insert(boards)
    .values({ slug, name: 'Tie board', access: DEFAULT_BOARD_ACCESS })
    .returning({ id: boards.id })

  // Every post shares one created_at and one vote_count: a total tie under
  // "new" and "top" alike, and under "trending" (votes / age).
  const createdAt = new Date('2026-10-01T12:00:00Z')
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    boardId: board.id as BoardId,
    title: `Tied post ${i}`,
    content: '',
    principalId,
    voteCount: 1,
    createdAt,
    moderationState: 'published' as const,
  }))
  const inserted = await testDb.insert(posts).values(rows).returning({ id: posts.id })
  return { slug, ids: inserted.map((r) => r.id) }
}

/** Walk every page the way the portal does: page 1 via the SSR query, the rest via the paged one. */
async function walkFeedAsPortal(slug: string, sort: 'top' | 'new' | 'trending') {
  const first = await listPublicPostsWithVotesAndAvatars({
    boardSlug: slug,
    sort,
    page: 1,
    limit: PAGE,
  })
  const seen = first.items.map((p) => p.id)
  let page = 2
  let hasMore = first.hasMore
  while (hasMore) {
    const next = await listPublicPosts({ boardSlug: slug, sort, page, limit: PAGE })
    seen.push(...next.items.map((p) => p.id))
    hasMore = next.hasMore
    page++
  }
  return seen
}

describe.skipIf(!fixture.available)('portal feed pagination under sort ties', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it.each(['new', 'top', 'trending'] as const)(
    'serves every tied post exactly once across pages and both queries (%s)',
    async (sort) => {
      const { slug, ids } = await seedTiedBoard()

      const walked = await walkFeedAsPortal(slug, sort)

      expect(walked).toHaveLength(TOTAL)
      expect(new Set(walked).size).toBe(TOTAL)
      expect(new Set(walked)).toEqual(new Set(ids))
      // The tie-breaker is the time-ordered id, newest first — a stated,
      // query-independent order rather than whatever the planner yields.
      expect(walked).toEqual([...ids].sort().reverse())
    }
  )
})
