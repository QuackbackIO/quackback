import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.service', async () => {
  const { getProductFlagUpdate } = await import('@/lib/shared/types/settings')
  return { getFeatureFlags: async () => getProductFlagUpdate('changelog', false) }
})
import { listPublicPosts } from '../post.public'
import { withPublicSearchMode } from '../post.public.search'
import { ANONYMOUS_ACTOR as ANONYMOUS } from '@/lib/server/policy'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function author(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Kaye', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return principalId
}

/** A board of its own, so the seeded posts never match. */
async function boardWith(
  ideas: Array<{ title: string; content?: string; votes?: number }>
): Promise<string> {
  const slug = `search-${createId('board').slice(-8)}`
  const [row] = await testDb.insert(boards).values({ name: 'Ideas', slug }).returning()
  const principalId = await author()
  for (const { title, content = 'x', votes = 0 } of ideas) {
    await testDb.insert(posts).values({
      boardId: row!.id as BoardId,
      principalId,
      title,
      content,
      voteCount: votes,
    })
  }
  return slug
}

async function search(boardSlug: string, query: string, sort: 'top' | 'relevance' = 'top') {
  const params = await withPublicSearchMode({ boardSlug, search: query }, ANONYMOUS)
  const { items } = await listPublicPosts({ ...params, sort, limit: 50, actor: ANONYMOUS })
  return items.map((p) => p.title)
}

it('matches the start of a word, so a search finds results as it is typed', async () => {
  const slug = await boardWith([{ title: 'Zapier integration' }, { title: 'Dark mode' }])
  expect(await search(slug, 'Zap')).toEqual(['Zapier integration'])
  expect(await search(slug, 'integ')).toEqual(['Zapier integration'])
})

it('needs every word while some idea has them all', async () => {
  const slug = await boardWith([{ title: 'CSV export' }, { title: 'PDF export' }])
  expect(await search(slug, 'csv export')).toEqual(['CSV export'])
})

it('falls back to half the words when no idea has them all, best match first', async () => {
  const slug = await boardWith([
    { title: 'Export to Sheets', votes: 50 },
    { title: 'CSV export', votes: 1 },
    { title: 'Export reports as CSV files', votes: 9 },
  ])
  // Both have two of the three words and the same text rank; votes decide.
  expect(await search(slug, 'csv export option', 'relevance')).toEqual([
    'Export reports as CSV files',
    'CSV export',
  ])
  // Every word beats some of them, whatever the votes.
  expect((await search(slug, 'sheets export', 'relevance'))[0]).toBe('Export to Sheets')
})

it('does not let one common word carry a search of nonsense', async () => {
  const slug = await boardWith([{ title: 'Merge duplicate posts' }])
  expect(await search(slug, 'xyzzy_no_such_post_zqwerty_99999')).toEqual([])
})

it('ranks a title match above a details match when sorted by best match', async () => {
  const slug = await boardWith([
    { title: 'Webhooks', content: 'Like the Zapier integration has', votes: 99 },
    { title: 'Zapier integration', votes: 0 },
  ])
  expect(await search(slug, 'zapier', 'relevance')).toEqual(['Zapier integration', 'Webhooks'])
  // Other sorts keep their own order.
  expect(await search(slug, 'zapier', 'top')).toEqual(['Webhooks', 'Zapier integration'])
})

it('keeps search operators: quotes, minus and OR', async () => {
  const slug = await boardWith([{ title: 'Slack alerts' }, { title: 'Email alerts' }])
  expect(await search(slug, 'alerts -slack')).toEqual(['Email alerts'])
  expect((await search(slug, 'slack OR email')).sort()).toEqual(['Email alerts', 'Slack alerts'])
})

it('treats punctuation as a word break and never errors on it', async () => {
  const slug = await boardWith([{ title: 'Zapier integration' }])
  expect(await search(slug, "zapier: & | ! ' (")).toEqual(['Zapier integration'])
  expect(await search(slug, '&&&')).toEqual([])
})
