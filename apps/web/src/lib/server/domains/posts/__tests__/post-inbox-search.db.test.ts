import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
import { listInboxPosts } from '../post.inbox'
import { withInboxSearchMode } from '../post.inbox.search'
import type { InboxPostListParams } from '../post.types'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

/** A board of its own, so the seeded posts never match. */
async function boardWith(
  ideas: Array<{ title: string; content?: string; votes?: number }>
): Promise<BoardId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Kaye', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  const slug = `search-${createId('board').slice(-8)}`
  const [row] = await testDb.insert(boards).values({ name: 'Ideas', slug }).returning()
  const boardId = row!.id as BoardId
  for (const { title, content = 'x', votes = 0 } of ideas) {
    await testDb.insert(posts).values({ boardId, principalId, title, content, voteCount: votes })
  }
  return boardId
}

async function search(
  boardId: BoardId,
  query: string,
  sort: InboxPostListParams['sort'] = 'votes',
  limit = 50
) {
  const params = await withInboxSearchMode({ boardIds: [boardId], search: query, sort, limit })
  const titles: string[] = []
  let cursor: string | undefined
  do {
    const page = await listInboxPosts({ ...params, cursor })
    titles.push(...page.items.map((p) => p.title))
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return titles
}

it('says how a search was widened', async () => {
  const boardId = await boardWith([{ title: 'Zapier integration' }, { title: 'CSV export' }])
  const mode = async (query: string) =>
    (await withInboxSearchMode({ boardIds: [boardId], search: query })).searchMode
  expect(await mode('zap')).toBe('all')
  expect(await mode('csv export option')).toBe('most')
  expect(await mode('integraton')).toBe('similar')
  expect(await mode('xyzzy')).toBe('all')
})

it('finds posts with most of the words, or a close spelling, when none has them all', async () => {
  const boardId = await boardWith([{ title: 'Zapier integration' }, { title: 'CSV export' }])
  expect(await search(boardId, 'csv export option')).toEqual(['CSV export'])
  expect(await search(boardId, 'zappier')).toEqual(['Zapier integration'])
})

it('ranks by best match, title above details', async () => {
  const boardId = await boardWith([
    { title: 'Webhooks', content: 'Like the Zapier integration has', votes: 99 },
    { title: 'Zapier integration', votes: 0 },
  ])
  expect(await search(boardId, 'zapier', 'relevance')).toEqual(['Zapier integration', 'Webhooks'])
  expect(await search(boardId, 'zapier', 'votes')).toEqual(['Webhooks', 'Zapier integration'])
})

it('pages a best match list without repeating or skipping a post', async () => {
  const boardId = await boardWith([
    { title: 'Export to Sheets', votes: 3 },
    { title: 'CSV export', votes: 1 },
    { title: 'CSV export', votes: 1 },
    { title: 'Export reports as CSV files', votes: 9 },
    { title: 'Export', content: 'csv please', votes: 5 },
    { title: 'Bulk export', votes: 1 },
  ])
  for (const query of ['csv export', 'export', 'csv export option']) {
    const whole = await search(boardId, query, 'relevance')
    expect(whole.length).toBeGreaterThan(2)
    expect(await search(boardId, query, 'relevance', 2)).toEqual(whole)
  }
  const similar = await search(boardId, 'exporrt', 'relevance')
  expect(similar.length).toBeGreaterThan(2)
  expect(await search(boardId, 'exporrt', 'relevance', 1)).toEqual(similar)
})

it('lists newest first under best match when there is no search', async () => {
  const boardId = await boardWith([{ title: 'First' }, { title: 'Second' }])
  const titles = await search(boardId, '', 'relevance')
  expect(titles.sort()).toEqual(['First', 'Second'])
})
