/**
 * Deleting a canonical post releases its merged duplicates (FBA-P-21). The
 * inbox hides every merged post, so a duplicate left merged into a deleted
 * post would vanish; released, it is listed again with its own votes.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, posts, postVotes, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'

const createActivity = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchPostDeleted: vi.fn(),
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({ createActivity }))
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  getPortalConfig: async () => DEFAULT_PORTAL_CONFIG,
}))

import { softDeletePost } from '../post.user-actions'
import { listInboxPosts } from '../post.inbox'

const fixture = await createDbTestFixture()
let admin: PrincipalId
let voter: PrincipalId
let boardId: BoardId
let canonical: PostId
let duplicate: PostId

async function seedPrincipal(role: 'admin' | 'user'): Promise<PrincipalId> {
  const id = createId('principal')
  const userId = createId('user')
  await testDb.insert(user).values({ id: userId, name: `P ${role}`, email: `${id}@example.com` })
  await testDb.insert(principal).values({ id, userId, type: 'user', role, createdAt: new Date() })
  return id
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  createActivity.mockReset()
  admin = await seedPrincipal('admin')
  voter = await seedPrincipal('user')
  boardId = createId('board')
  await testDb
    .insert(boards)
    .values({ id: boardId, name: 'Feedback', slug: String(boardId), access: DEFAULT_BOARD_ACCESS })
  canonical = createId('post')
  duplicate = createId('post')
  await testDb.insert(posts).values([
    { id: canonical, boardId, title: 'Canonical', content: '', principalId: admin, voteCount: 1 },
    {
      id: duplicate,
      boardId,
      title: 'Duplicate',
      content: '',
      principalId: voter,
      canonicalPostId: canonical,
      mergedAt: new Date(),
      mergedByPrincipalId: admin,
      voteCount: 0,
    },
  ])
  await testDb.insert(postVotes).values({ postId: duplicate, principalId: voter })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

it('releases the duplicates of a deleted canonical, with their own votes, back into the inbox', async () => {
  await softDeletePost(canonical, { principalId: admin, role: 'admin' })

  const [row] = await testDb
    .select({
      canonicalPostId: posts.canonicalPostId,
      mergedAt: posts.mergedAt,
      voteCount: posts.voteCount,
    })
    .from(posts)
    .where(eq(posts.id, duplicate))
  expect(row).toEqual({ canonicalPostId: null, mergedAt: null, voteCount: 1 })

  const listed = await listInboxPosts({ boardIds: [boardId] })
  expect(listed.items.map((p) => p.title)).toEqual(['Duplicate'])
  expect(createActivity).toHaveBeenCalledWith(
    expect.objectContaining({ postId: duplicate, type: 'post.unmerged' })
  )
})

it('leaves a deleted duplicate’s canonical alone', async () => {
  await softDeletePost(duplicate, { principalId: admin, role: 'admin' })

  const [row] = await testDb
    .select({ canonicalPostId: posts.canonicalPostId })
    .from(posts)
    .where(eq(posts.id, duplicate))
  expect(row.canonicalPostId).toBe(canonical)
  const listed = await listInboxPosts({ boardIds: [boardId] })
  expect(listed.items.map((p) => p.title)).toEqual(['Canonical'])
})
