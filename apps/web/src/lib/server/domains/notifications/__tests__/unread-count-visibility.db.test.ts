/**
 * The unread badge counts only bells the person can open. Once a bell's post
 * is deleted (or otherwise hidden from them) the list redacts it, so the
 * badge and the list's own unread count leave it out too; a bell with no post
 * always counts.
 *
 * Real Postgres in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, inAppNotifications, posts, principal, user } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { getUnreadCount, getNotificationsForMember } = await import('../notification.service')

const fixture = await createDbTestFixture()
const tag = Math.random().toString(36).slice(2, 8)

describe.skipIf(!fixture.available)('unread badge visibility (real DB)', () => {
  let me: PrincipalId
  let actor: Actor
  let postId: PostId

  beforeEach(async () => {
    await fixture.begin()
    const userId = createId('user') as UserId
    me = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: `Fan ${tag}`, email: `n-${tag}@x.io` })
    await testDb
      .insert(principal)
      .values({ id: me, userId, role: 'user', type: 'user', createdAt: new Date() })
    actor = {
      principalId: me,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(),
    }
    const boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, name: `B ${tag}`, slug: `bell-${tag}` })
    postId = createId('post') as PostId
    await testDb
      .insert(posts)
      .values({ id: postId, boardId, title: `Followed ${tag}`, content: '', principalId: me })
    await testDb.insert(inAppNotifications).values([
      {
        id: createId('notification'),
        principalId: me,
        type: 'post_status_changed',
        title: 'Status changed to Planned',
        postId,
      },
      {
        id: createId('notification'),
        principalId: me,
        type: 'changelog_published',
        title: 'Something shipped',
      },
    ])
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts every unread bell while the post is live', async () => {
    expect(await getUnreadCount(me, actor)).toBe(2)
  })

  it('leaves out a bell whose post was deleted, in the badge and in the list count', async () => {
    await testDb.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId))

    expect(await getUnreadCount(me, actor)).toBe(1)
    const list = await getNotificationsForMember(me, {}, actor)
    expect(list.unreadCount).toBe(1)
  })

  it('leaves out a bell whose post is held for moderation and not the reader’s', async () => {
    const other = createId('principal') as PrincipalId
    await testDb
      .insert(principal)
      .values({ id: other, role: 'user', type: 'anonymous', createdAt: new Date() })
    await testDb
      .update(posts)
      .set({ moderationState: 'pending', principalId: other })
      .where(eq(posts.id, postId))

    expect(await getUnreadCount(me, actor)).toBe(1)
  })
})
