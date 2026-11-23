/**
 * A public profile shows only published comments: a comment still waiting for
 * review neither lists its post under "Commented on" nor counts in the header.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postComments, posts, principal, user } from '@/lib/server/db'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { getPublicUserProfile } from '../user.public-profile'

const fixture = await createDbTestFixture()
let boardId: BoardId, owner: PrincipalId

async function person() {
  const userId = createId('user')
  const id = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId, type: 'user', role: 'user', createdAt: new Date() })
  return id
}

async function post(): Promise<PostId> {
  const id = createId('post')
  await testDb.insert(posts).values({
    id,
    boardId,
    principalId: await person(),
    title: 'Acme idea',
    content: 'Please add this.',
  })
  return id
}

async function comment(postId: PostId, moderationState: 'published' | 'pending') {
  await testDb
    .insert(postComments)
    .values({ postId, principalId: owner, content: 'Acme comment', moderationState })
}

describe('public profile comments', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    owner = await person()
    boardId = createId('board')
    await testDb.insert(boards).values({ id: boardId, name: 'Acme', slug: String(boardId) })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists and counts published comments only', async () => {
    const held = await post()
    const published = await post()
    await comment(held, 'pending')
    await comment(published, 'published')

    const profile = await getPublicUserProfile(owner, ANONYMOUS_ACTOR)

    expect(profile!.comments.map((item) => item.postId)).toEqual([published])
    expect(profile!.commentCount).toBe(1)
  })

  it('does not resolve a profile whose only activity is a held comment', async () => {
    await comment(await post(), 'pending')

    expect(await getPublicUserProfile(owner, ANONYMOUS_ACTOR)).toBeNull()
  })
})
