/**
 * The moderation queue leaves out what a test customer wrote, as the sidebar
 * badge, banner and filter counts do (FBA-Q-04): a held post by a test
 * customer, a held comment by one, and a held comment on a test customer's
 * post.
 *
 * Real Postgres in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { boards, postComments, posts, principal, user } from '@/lib/server/db'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPendingComments, listPendingPosts } from '../moderation.service'

const fixture = await createDbTestFixture()
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function seedPrincipal(opts: { role: string; testOwner?: PrincipalId }) {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `P ${tag()}` })
  await testDb.insert(principal).values({
    id,
    userId,
    role: opts.role,
    type: 'user',
    createdAt: new Date(),
    testOwnerPrincipalId: opts.testOwner ?? null,
  })
  return id
}

describe.skipIf(!fixture.available)('moderation queue and test customers (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('FBA-Q-04 lists no held post or comment a test customer is behind', async () => {
    const teammate = await seedPrincipal({ role: 'admin' })
    const tester = await seedPrincipal({ role: 'user', testOwner: teammate })
    const customer = await seedPrincipal({ role: 'user' })
    const [board] = await testDb
      .insert(boards)
      .values({ slug: `mod-${tag()}`, name: 'Mod', access: DEFAULT_BOARD_ACCESS })
      .returning()
    const held = (title: string, principalId: PrincipalId) =>
      testDb
        .insert(posts)
        .values({
          boardId: board.id,
          title,
          content: '',
          principalId,
          moderationState: 'pending',
        })
        .returning()
        .then((r) => r[0])
    const live = (title: string, principalId: PrincipalId) =>
      testDb
        .insert(posts)
        .values({ boardId: board.id, title, content: '', principalId })
        .returning()
        .then((r) => r[0])

    const realPost = await held('Real held', customer)
    const testPost = await held('Test held', tester)
    const realLive = await live('Real live', customer)
    const testLive = await live('Test live', tester)
    const comment = (postId: typeof realLive.id, principalId: PrincipalId, content: string) =>
      testDb
        .insert(postComments)
        .values({ postId, principalId, content, moderationState: 'pending' })
        .returning()
        .then((r) => r[0])
    const realComment = await comment(realLive.id, customer, 'real on real')
    const testerComment = await comment(realLive.id, tester, 'tester on real')
    const onTestPost = await comment(testLive.id, customer, 'real on test post')

    const postIds = (await listPendingPosts()).map((p) => p.id)
    expect(postIds).toContain(realPost.id)
    expect(postIds).not.toContain(testPost.id)

    const commentIds = (await listPendingComments()).map((c) => c.id)
    expect(commentIds).toContain(realComment.id)
    expect(commentIds).not.toContain(testerComment.id)
    expect(commentIds).not.toContain(onTestPost.id)
  })
})
