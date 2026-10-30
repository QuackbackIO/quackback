/**
 * Real-DB coverage for the portal Following page's post list
 * (following.service.ts): one row per thread, newest follow first, and only
 * the posts the person can see today.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, posts, postSubscriptions, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS, type BoardAccess } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listFollowedPosts } from '../following.service'
import { subscribeToPost } from '../subscription.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: postSubscriptions.id }).from(postSubscriptions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedCustomer(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Ada', email: `${suffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Ada',
    createdAt: new Date(),
  })
  return principalId
}

async function seedPost(
  author: PrincipalId,
  title: string,
  access: BoardAccess = DEFAULT_BOARD_ACCESS
): Promise<PostId> {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `follow-${suffix()}`, name: 'Ideas', access })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({ boardId: board.id as BoardId, title, content: '', principalId: author })
    .returning()
  return post.id as PostId
}

describe.skipIf(!fixture.available)('the Following page post list (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists the visible posts someone follows, a merged follow as the surviving post', async () => {
    const ada = await seedCustomer()
    const me: Actor = {
      principalId: ada,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
    }
    const older = await seedPost(ada, 'Dark mode')
    const canonical = await seedPost(ada, 'Export to CSV')
    const hidden = await seedPost(ada, 'Internal roadmap', {
      ...DEFAULT_BOARD_ACCESS,
      view: 'team',
      vote: 'team',
      comment: 'team',
      submit: 'team',
    })
    const [{ boardId }] = await testDb.select().from(posts).where(eq(posts.id, canonical))
    const [source] = await testDb
      .insert(posts)
      .values({
        boardId,
        title: 'CSV export',
        content: '',
        principalId: ada,
        canonicalPostId: canonical,
      })
      .returning()

    await subscribeToPost(ada, older, 'author', { level: 'status_only' })
    await testDb
      .update(postSubscriptions)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(postSubscriptions.postId, older))
    await subscribeToPost(ada, source.id as PostId, 'vote')
    await subscribeToPost(ada, hidden, 'manual')

    const followed = await listFollowedPosts(me)
    expect(followed.map((p) => [p.postId, p.title, p.level, p.reason])).toEqual([
      [canonical, 'Export to CSV', 'all', 'vote'],
      [older, 'Dark mode', 'status_only', 'author'],
    ])
    expect(followed[0]).toMatchObject({ boardName: 'Ideas' })
  })

  it('is empty for someone who follows nothing', async () => {
    const ada = await seedCustomer()
    expect(
      await listFollowedPosts({
        principalId: ada,
        role: 'user',
        principalType: 'user',
        segmentIds: new Set(),
      })
    ).toEqual([])
  })
})
