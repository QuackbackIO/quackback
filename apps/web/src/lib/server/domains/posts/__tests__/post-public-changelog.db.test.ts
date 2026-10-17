import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createId,
  type PostId,
  type PrincipalId,
  type SegmentId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  changelogCategories,
  changelogEntries,
  changelogEntryCategories,
  changelogEntryPosts,
  eq,
  posts,
  principal,
  user,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const flags = vi.hoisted(() => ({ changelogOn: true }))
vi.mock('@/lib/server/domains/settings/settings.service', async () => {
  const { getProductFlagUpdate } = await import('@/lib/shared/types/settings')
  return { getFeatureFlags: async () => getProductFlagUpdate('changelog', flags.changelogOn) }
})
import { changelogLinkColumn, toChangelogLink } from '../post.public.changelog'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  flags.changelogOn = true
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

const visitor: Actor = {
  principalId: null,
  role: null,
  principalType: 'anonymous',
  segmentIds: new Set(),
}

/** Runs the feed's link column for one post, the way the list queries do. */
async function linkFor(postId: PostId, actor: Actor = visitor) {
  const [row] = await testDb
    .select({ link: await changelogLinkColumn(actor, true) })
    .from(posts)
    .where(eq(posts.id, postId))
  return toChangelogLink(row!.link)
}

it('links a post to its newest published changelog entry', async () => {
  const postId = await post()
  const older = await entry('Older', new Date('2026-01-01'))
  const newer = await entry('Newer', new Date('2026-02-01'))
  await testDb.insert(changelogEntryPosts).values([
    { changelogEntryId: older.id, postId },
    { changelogEntryId: newer.id, postId },
  ])

  expect(await linkFor(postId)).toEqual({ id: newer.id, title: 'Newer' })
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

  expect(await linkFor(postId)).toBeNull()
})

it('links nothing for a post no entry announced', async () => {
  expect(await linkFor(await post())).toBeNull()
})

it('links nothing while the changelog is switched off', async () => {
  const postId = await post()
  const published = await entry('Published', new Date('2026-01-01'))
  await testDb.insert(changelogEntryPosts).values({ changelogEntryId: published.id, postId })
  flags.changelogOn = false

  expect(await linkFor(postId)).toBeNull()
})

it('hides an entry whose category is limited to segments the viewer is not in', async () => {
  const postId = await post()
  const gated = await entry('Enterprise SSO', new Date('2026-01-01'))
  const segment = createId('segment') as SegmentId
  const [category] = await testDb
    .insert(changelogCategories)
    .values({ name: `Enterprise ${segment.slice(-6)}`, color: '#000000', segmentIds: [segment] })
    .returning()
  await testDb
    .insert(changelogEntryCategories)
    .values({ changelogEntryId: gated.id, categoryId: category!.id })
  await testDb.insert(changelogEntryPosts).values({ changelogEntryId: gated.id, postId })

  const member: Actor = {
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([segment]),
  }
  const team: Actor = { ...member, role: 'admin', segmentIds: new Set() }

  expect(await linkFor(postId)).toBeNull()
  expect(await linkFor(postId, member)).toEqual({ id: gated.id, title: 'Enterprise SSO' })
  expect(await linkFor(postId, team)).toEqual({ id: gated.id, title: 'Enterprise SSO' })
})

it('links nothing unless the feed asks for links', async () => {
  const postId = await post()
  const published = await entry('Published', new Date('2026-01-01'))
  await testDb.insert(changelogEntryPosts).values({ changelogEntryId: published.id, postId })

  const [row] = await testDb
    .select({ link: await changelogLinkColumn(visitor, false) })
    .from(posts)
    .where(eq(posts.id, postId))
  expect(toChangelogLink(row!.link)).toBeNull()
})
