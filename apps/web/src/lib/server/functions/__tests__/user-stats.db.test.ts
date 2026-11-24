/**
 * The widget user menu counts live activity only, as the public profile does: a held or
 * deleted idea is not counted, a vote on a deleted or held idea is not
 * counted, and a comment counts only when it is published, public, undeleted
 * and on a live idea.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postComments, postVotes, posts, principal, user } from '@/lib/server/db'

vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  createServerOnlyFn: <T>(fn: T) => fn,
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { runGetUserStats } from '../user'

const fixture = await createDbTestFixture()
let boardId: BoardId, me: PrincipalId, other: PrincipalId

async function person() {
  const userId = createId('user')
  const id = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId, type: 'user', role: 'user', createdAt: new Date() })
  return id
}

type PostState = { by?: PrincipalId; held?: boolean; deleted?: boolean; removed?: boolean }

async function post({ by = other, held, deleted, removed }: PostState = {}): Promise<PostId> {
  const id = createId('post')
  await testDb.insert(posts).values({
    id,
    boardId,
    principalId: by,
    title: 'Acme idea',
    content: 'Please add this.',
    moderationState: held ? 'pending' : removed ? 'deleted' : 'published',
    deletedAt: deleted ? new Date() : null,
  })
  return id
}

async function comment(
  postId: PostId,
  state: { held?: boolean; isPrivate?: boolean; deleted?: boolean } = {}
) {
  await testDb.insert(postComments).values({
    postId,
    principalId: me,
    content: 'Acme comment',
    moderationState: state.held ? 'pending' : 'published',
    isPrivate: state.isPrivate ?? false,
    deletedAt: state.deleted ? new Date() : null,
  })
}

describe('runGetUserStats', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    me = await person()
    other = await person()
    boardId = createId('board')
    await testDb.insert(boards).values({ id: boardId, name: 'Acme', slug: String(boardId) })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts live ideas, votes and comments', async () => {
    const mine = await post({ by: me })
    const theirs = await post()
    await testDb.insert(postVotes).values([
      { postId: mine, principalId: me },
      { postId: theirs, principalId: me },
    ])
    await comment(theirs)

    expect(await runGetUserStats(me)).toEqual({ ideas: 1, votes: 2, comments: 1 })
  })

  it('leaves out held and deleted ideas, and votes and comments on them', async () => {
    await post({ by: me })
    await post({ by: me, held: true })
    await post({ by: me, removed: true })
    const gone = await post({ deleted: true })
    const held = await post({ held: true })
    await testDb.insert(postVotes).values([
      { postId: gone, principalId: me },
      { postId: held, principalId: me },
    ])
    await comment(gone)
    await comment(held)

    expect(await runGetUserStats(me)).toEqual({ ideas: 1, votes: 0, comments: 0 })
  })

  it('counts only published, public, undeleted comments', async () => {
    const live = await post()
    await comment(live)
    await comment(live, { held: true })
    await comment(live, { isPrivate: true })
    await comment(live, { deleted: true })

    expect(await runGetUserStats(me)).toMatchObject({ comments: 1 })
  })
})
