import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  changelogEntries,
  changelogEntryPosts,
  posts,
  principal,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
import { getChangelogLinksForPosts } from '../post.public.changelog'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function post(): Promise<PostId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Ideas', slug: `ideas-${createId('board').slice(-6)}` })
    .returning()
  const [row] = await testDb
    .insert(posts)
    .values({ boardId: board!.id, principalId, title: 'Dark mode', content: 'x' })
    .returning()
  return row!.id
}

async function entry(title: string, publishedAt: Date | null, deletedAt: Date | null = null) {
  const [row] = await testDb
    .insert(changelogEntries)
    .values({ title, content: 'x', publishedAt, deletedAt })
    .returning()
  return row!
}

it('links a post to its newest published changelog entry', async () => {
  const postId = await post()
  const older = await entry('Older', new Date('2026-01-01'))
  const newer = await entry('Newer', new Date('2026-02-01'))
  await testDb.insert(changelogEntryPosts).values([
    { changelogEntryId: older.id, postId },
    { changelogEntryId: newer.id, postId },
  ])

  const links = await getChangelogLinksForPosts([postId])

  expect(links.get(postId)).toEqual({ id: newer.id, title: 'Newer' })
})

it('ignores drafts, scheduled and deleted entries', async () => {
  const postId = await post()
  const draft = await entry('Draft', null)
  const scheduled = await entry('Scheduled', new Date(Date.now() + 86_400_000))
  const deleted = await entry('Deleted', new Date('2026-01-01'), new Date())
  await testDb.insert(changelogEntryPosts).values([
    { changelogEntryId: draft.id, postId },
    { changelogEntryId: scheduled.id, postId },
    { changelogEntryId: deleted.id, postId },
  ])

  const links = await getChangelogLinksForPosts([postId])

  expect(links.has(postId)).toBe(false)
})

it('returns an empty map without querying for an empty page', async () => {
  expect((await getChangelogLinksForPosts([])).size).toBe(0)
})
