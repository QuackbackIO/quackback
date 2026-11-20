/**
 * A comment can carry a status change ("Comment & mark") only for a teammate
 * who holds post.set_status (FBA-P-30). Without it the comment is refused and
 * neither the comment nor the status is written.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PostId, type PostStatusId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, postComments, posts, postStatuses, principal, user } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: async () => DEFAULT_PORTAL_CONFIG,
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({ createActivity: vi.fn() }))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchCommentCreated: vi.fn(),
  dispatchPostStatusChanged: vi.fn(),
}))

import { createComment } from '../comment.service'

const fixture = await createDbTestFixture()
let teammate: PrincipalId
let postId: PostId
let open: PostStatusId
let done: PostStatusId

function memberActor(withSetStatus: boolean): Actor {
  const permissions = new Set(resolveActorPermissions('member'))
  if (withSetStatus) permissions.add(PERMISSIONS.POST_SET_STATUS)
  else permissions.delete(PERMISSIONS.POST_SET_STATUS)
  return {
    principalId: teammate,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions,
  }
}

async function statusOf(id: PostId) {
  const [row] = await testDb
    .select({ statusId: posts.statusId })
    .from(posts)
    .where(eq(posts.id, id))
  return row.statusId
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  teammate = createId('principal')
  const userId = createId('user')
  await testDb.insert(user).values({ id: userId, name: 'Teammate', email: `${teammate}@x.test` })
  await testDb
    .insert(principal)
    .values({ id: teammate, userId, type: 'user', role: 'member', createdAt: new Date() })
  const boardId = createId('board')
  await testDb
    .insert(boards)
    .values({ id: boardId, name: 'Feedback', slug: String(boardId), access: DEFAULT_BOARD_ACCESS })
  open = createId('post_status')
  done = createId('post_status')
  await testDb.insert(postStatuses).values([
    { id: open, name: 'Open', slug: `open-${open}` },
    { id: done, name: 'Done', slug: `done-${done}`, category: 'complete' },
  ])
  postId = createId('post')
  await testDb.insert(posts).values({
    id: postId,
    boardId,
    title: 'An idea',
    content: '',
    statusId: open,
    principalId: teammate,
  })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

const author = () => ({ principalId: teammate, role: 'member' as const })

it('refuses a status change from a teammate without post.set_status, writing nothing', async () => {
  await expect(
    createComment(
      { postId, content: 'Sneaking a status', statusId: done },
      author(),
      memberActor(false),
      { skipDispatch: true }
    )
  ).rejects.toMatchObject({ code: 'STATUS_CHANGE_FORBIDDEN' })
  expect(await statusOf(postId)).toBe(open)
  const comments = await testDb
    .select({ id: postComments.id })
    .from(postComments)
    .where(eq(postComments.postId, postId))
  expect(comments).toEqual([])
})

it('lets a teammate without post.set_status comment without a status', async () => {
  const result = await createComment(
    { postId, content: 'Just a comment' },
    author(),
    memberActor(false),
    { skipDispatch: true }
  )
  expect(result.comment.content).toBe('Just a comment')
})

it('changes the status for a teammate who holds post.set_status', async () => {
  await createComment({ postId, content: 'Shipped', statusId: done }, author(), memberActor(true), {
    skipDispatch: true,
  })
  expect(await statusOf(postId)).toBe(done)
})
