/**
 * Re-picking the status a post already has changes nothing (FBA-P-08): no
 * status.changed activity, no post.status_changed event (which is what emails
 * subscribers), and the post comes back as it was.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostId,
  type PostStatusId,
  type PrincipalId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, postStatuses, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

const dispatchPostStatusChanged = vi.hoisted(() => vi.fn())
const createActivity = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchPostStatusChanged,
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({ createActivity }))

import { changeStatus } from '../post.status'

const fixture = await createDbTestFixture()
let admin: PrincipalId
let boardId: BoardId
let open: PostStatusId
let planned: PostStatusId
let postId: PostId

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  dispatchPostStatusChanged.mockReset()
  createActivity.mockReset()
  admin = createId('principal')
  const adminUser = createId('user')
  await testDb.insert(user).values({ id: adminUser, name: 'Admin', email: 'admin@example.com' })
  await testDb
    .insert(principal)
    .values({ id: admin, userId: adminUser, type: 'user', role: 'admin', createdAt: new Date() })
  boardId = createId('board')
  await testDb
    .insert(boards)
    .values({ id: boardId, name: 'Feedback', slug: String(boardId), access: DEFAULT_BOARD_ACCESS })
  open = createId('post_status')
  planned = createId('post_status')
  await testDb.insert(postStatuses).values([
    { id: open, name: 'Open', slug: `open-${open}` },
    { id: planned, name: 'Planned', slug: `planned-${planned}` },
  ])
  postId = createId('post')
  await testDb.insert(posts).values({
    id: postId,
    boardId,
    title: 'An idea',
    content: '',
    statusId: open,
    principalId: admin,
  })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

it('does nothing when the post already has the status', async () => {
  const result = await changeStatus(postId, open, { principalId: admin })

  expect(result.statusId).toBe(open)
  expect(result.previousStatus).toBe('Open')
  expect(result.newStatus).toBe('Open')
  expect(result.enteredComplete).toBe(false)
  expect(dispatchPostStatusChanged).not.toHaveBeenCalled()
  expect(createActivity).not.toHaveBeenCalled()
})

it('still records and announces a real change', async () => {
  const result = await changeStatus(postId, planned, { principalId: admin })

  expect(result.statusId).toBe(planned)
  expect(dispatchPostStatusChanged).toHaveBeenCalledTimes(1)
  expect(createActivity).toHaveBeenCalledWith(
    expect.objectContaining({ postId, type: 'status.changed' })
  )
})
