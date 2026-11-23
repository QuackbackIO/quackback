/**
 * Post writes against a real database: tags, statuses and deleted posts on
 * createPost / updatePost, and the voter lookup on addVoteOnBehalf. Each case
 * here once answered a 500 or wrote what it should have refused.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostId,
  type PostStatusId,
  type PostTagId,
  type PrincipalId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  posts,
  postStatuses,
  postTagAssignments,
  postTags,
  postVotes,
  principal,
  user,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'

const dispatchPostStatusChanged = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchPostStatusChanged,
  dispatchPostUpdated: vi.fn(),
  dispatchPostOwnerAssigned: vi.fn(),
  dispatchPostVoted: vi.fn(),
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({ createActivity: vi.fn() }))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: async (json: unknown) => json,
}))
vi.mock('@/lib/server/domains/posts/post.autotag', () => ({ autoTagPost: async () => [] }))
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generatePostEmbedding: async () => undefined,
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  getPortalConfig: async () => DEFAULT_PORTAL_CONFIG,
}))

import { createPost, updatePost } from '../post.service'
import { addVoteOnBehalf } from '../post.voting'

const fixture = await createDbTestFixture()
let admin: PrincipalId
let boardId: BoardId
let open: PostStatusId
let done: PostStatusId
let tagA: PostTagId
let tagB: PostTagId
let postId: PostId

const teamAuthor = () => ({
  principalId: admin,
  actor: { principalId: admin, principalType: 'user', role: 'admin' } as never,
})
const actor = () => ({ principalId: admin })

async function tagsOf(id: PostId) {
  const rows = await testDb
    .select({ tagId: postTagAssignments.tagId })
    .from(postTagAssignments)
    .where(eq(postTagAssignments.postId, id))
  return rows.map((r) => r.tagId).sort()
}

async function postsOnBoard() {
  return testDb.select({ id: posts.id }).from(posts).where(eq(posts.boardId, boardId))
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  dispatchPostStatusChanged.mockReset()
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
  done = createId('post_status')
  await testDb.insert(postStatuses).values([
    { id: open, name: 'Open', slug: `open-${open}` },
    { id: done, name: 'Done', slug: `done-${done}` },
  ])
  tagA = createId('post_tag')
  tagB = createId('post_tag')
  await testDb.insert(postTags).values([
    { id: tagA, name: `a-${tagA}` },
    { id: tagB, name: `b-${tagB}` },
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
  await testDb.insert(postTagAssignments).values([
    { postId, tagId: tagA },
    { postId, tagId: tagB },
  ])
})
afterEach(fixture.rollback)
afterAll(fixture.close)

// ---------------------------------------------------------------- createPost

it('refuses an unknown tag on create without leaving a post', async () => {
  const before = await postsOnBoard()
  await expect(
    createPost(
      { boardId, title: 'Tagged', statusId: open, tagIds: [createId('post_tag')] },
      teamAuthor(),
      { skipDispatch: true }
    )
  ).rejects.toMatchObject({ constructor: NotFoundError, code: 'TAG_NOT_FOUND' })
  expect(await postsOnBoard()).toEqual(before)
})

it('refuses a repeated tag on create without leaving a post', async () => {
  const before = await postsOnBoard()
  await expect(
    createPost({ boardId, title: 'Tagged', statusId: open, tagIds: [tagA, tagA] }, teamAuthor(), {
      skipDispatch: true,
    })
  ).rejects.toMatchObject({ constructor: ValidationError, code: 'VALIDATION_ERROR' })
  expect(await postsOnBoard()).toEqual(before)
})

it('refuses a deleted tag on create', async () => {
  await testDb.update(postTags).set({ deletedAt: new Date() }).where(eq(postTags.id, tagB))
  await expect(
    createPost({ boardId, title: 'Tagged', statusId: open, tagIds: [tagB] }, teamAuthor(), {
      skipDispatch: true,
    })
  ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })
})

it('creates a post with distinct live tags', async () => {
  const post = await createPost(
    { boardId, title: 'Tagged', statusId: open, tagIds: [tagA, tagB] },
    teamAuthor(),
    { skipDispatch: true }
  )
  expect(await tagsOf(post.id)).toEqual([tagA, tagB].sort())
})

it('refuses a deleted status on create', async () => {
  await testDb.update(postStatuses).set({ deletedAt: new Date() }).where(eq(postStatuses.id, done))
  const before = await postsOnBoard()
  await expect(
    createPost({ boardId, title: 'Done already', statusId: done }, teamAuthor(), {
      skipDispatch: true,
    })
  ).rejects.toMatchObject({ constructor: NotFoundError, code: 'STATUS_NOT_FOUND' })
  expect(await postsOnBoard()).toEqual(before)
})

// ---------------------------------------------------------------- updatePost

it("refuses an unknown tag on update and keeps the post's tags", async () => {
  await expect(
    updatePost(postId, { tagIds: [tagA, createId('post_tag')] }, actor())
  ).rejects.toMatchObject({ constructor: NotFoundError, code: 'TAG_NOT_FOUND' })
  expect(await tagsOf(postId)).toEqual([tagA, tagB].sort())
})

it("refuses a repeated tag on update and keeps the post's tags", async () => {
  await expect(updatePost(postId, { tagIds: [tagA, tagA] }, actor())).rejects.toMatchObject({
    constructor: ValidationError,
    code: 'VALIDATION_ERROR',
  })
  expect(await tagsOf(postId)).toEqual([tagA, tagB].sort())
})

it('writes nothing when the tags are refused alongside a title change', async () => {
  await expect(
    updatePost(postId, { title: 'Renamed', tagIds: [createId('post_tag')] }, actor())
  ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })
  const row = await testDb.query.posts.findFirst({ where: eq(posts.id, postId) })
  expect(row!.title).toBe('An idea')
})

it('keeps a deleted tag the post already carries when the tags are re-sent', async () => {
  await testDb.update(postTags).set({ deletedAt: new Date() }).where(eq(postTags.id, tagB))
  await updatePost(postId, { tagIds: [tagA, tagB] }, actor())
  expect(await tagsOf(postId)).toEqual([tagA, tagB].sort())
  await updatePost(postId, { tagIds: [tagA] }, actor())
  await expect(updatePost(postId, { tagIds: [tagA, tagB] }, actor())).rejects.toMatchObject({
    code: 'TAG_NOT_FOUND',
  })
})

it('replaces the tags', async () => {
  await updatePost(postId, { tagIds: [tagB] }, actor())
  expect(await tagsOf(postId)).toEqual([tagB])
  await updatePost(postId, { tagIds: [] }, actor())
  expect(await tagsOf(postId)).toEqual([])
})

it('refuses a deleted status on update', async () => {
  await testDb.update(postStatuses).set({ deletedAt: new Date() }).where(eq(postStatuses.id, done))
  await expect(updatePost(postId, { statusId: done }, actor())).rejects.toMatchObject({
    constructor: NotFoundError,
    code: 'STATUS_NOT_FOUND',
  })
  const row = await testDb.query.posts.findFirst({ where: eq(posts.id, postId) })
  expect(row!.statusId).toBe(open)
})

it('treats a deleted post as not found and announces nothing', async () => {
  await testDb.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId))
  await expect(updatePost(postId, { statusId: done }, actor())).rejects.toMatchObject({
    constructor: NotFoundError,
    code: 'POST_NOT_FOUND',
  })
  const row = await testDb.query.posts.findFirst({ where: eq(posts.id, postId) })
  expect(row!.statusId).toBe(open)
  expect(dispatchPostStatusChanged).not.toHaveBeenCalled()
})

// ---------------------------------------------------------------- addVoteOnBehalf

it('refuses a proxy vote for an unknown voter as not found', async () => {
  await expect(addVoteOnBehalf(postId, createId('principal'))).rejects.toMatchObject({
    constructor: NotFoundError,
    code: 'PRINCIPAL_NOT_FOUND',
  })
  const votes = await testDb.select().from(postVotes).where(eq(postVotes.postId, postId))
  expect(votes).toEqual([])
})

it('accepts a proxy vote for any existing principal', async () => {
  const service = createId('principal')
  await testDb
    .insert(principal)
    .values({ id: service, type: 'service', role: 'member', createdAt: new Date() })
  expect(await addVoteOnBehalf(postId, service)).toMatchObject({ voted: true })
})
