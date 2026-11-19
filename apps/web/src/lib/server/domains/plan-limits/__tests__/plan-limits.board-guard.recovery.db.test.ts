/**
 * Read-only boards against a real database, the edges around the guard: the
 * vote write itself (not only the error), the exact end of the grace, coming
 * back on an upgrade or a fix, an install without plan billing, a failed plan
 * read, and the visitor path at the posts cap.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  boards,
  count,
  eq,
  inArray,
  isNull,
  postVotes,
  posts,
  principal,
  settings,
  user,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import type { Actor } from '@/lib/server/policy/types'

const usage = vi.hoisted(() => ({ fail: false }))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchPostCreated: vi.fn(),
  dispatchPostVoted: vi.fn(),
  dispatchCommentCreated: vi.fn(),
}))
// The usage count is the plan limits read that touches the database; a failed
// count is how a plan limits read fails in practice.
vi.mock('@/lib/server/domains/billing/usage-counts', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/billing/usage-counts')>()
  return {
    ...real,
    loadUsageCounts: async (...args: Parameters<typeof real.loadUsageCounts>) => {
      if (usage.fail) throw new Error('usage count failed')
      return real.loadUsageCounts(...args)
    },
  }
})
vi.mock('@tanstack/react-start/server', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => new Headers(),
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { createPost } from '@/lib/server/domains/posts/post.service'
import { voteOnPost, addVoteOnBehalf } from '@/lib/server/domains/posts/post.voting'
import { createComment } from '@/lib/server/domains/comments/comment.service'
import { runCreatePublicPost } from '@/lib/server/functions/public-posts'
import { getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'
import {
  BOARD_READ_ONLY_MESSAGE,
  BoardReadOnlyError,
  withVisitorPostCapCopy,
} from '../plan-limits.board-guard'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000
const FREE_LIKE = { ...OSS_TIER_LIMITS, maxBoards: 1 }

let ownerId: PrincipalId
let voterId: PrincipalId
let voterUserId: UserId
let adminActor: Actor
let openBoard: BoardId
let closedBoard: BoardId
let closedPost: PostId

async function configure(planLimits: boolean, tierLimits: object = FREE_LIKE) {
  await testDb.update(settings).set({
    featureFlags: JSON.stringify({ feedback: true, planLimits }),
    tierLimits: JSON.stringify(tierLimits),
  })
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
}

async function enforce() {
  await configure(true)
  await getPlanLimits()
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
  expect((await getPlanLimits()).phase).toBe('enforced')
}

async function addBoard(name: string, postCount: number, createdAt: Date) {
  const id = createId('board') as BoardId
  await testDb.insert(boards).values({ id, name, slug: String(id), createdAt })
  const ids: PostId[] = []
  for (let i = 0; i < postCount; i++) {
    const postId = createId('post') as PostId
    await testDb
      .insert(posts)
      .values({ id: postId, boardId: id, title: `Acme ${i}`, content: '', principalId: ownerId })
    ids.push(postId)
  }
  return { id, postIds: ids }
}

const newPost = (boardId: BoardId) =>
  createPost(
    { boardId, title: 'Acme idea', content: 'Details' },
    { principalId: ownerId, actor: adminActor },
    { skipDispatch: true }
  )
const newComment = (postId: PostId) =>
  createComment(
    { postId, content: 'Acme comment' },
    { principalId: ownerId, role: 'admin' },
    adminActor,
    { skipDispatch: true }
  )

/** A portal user who has not voted yet, so a vote always adds one. */
async function freshVoter(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Acme Fan', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId, role: 'user', type: 'user', createdAt: new Date() })
  return id
}

/** Every create path on the board answers open (resolves) or closed (refuses). */
async function expectEveryPath(boardId: BoardId, postId: PostId, open: boolean) {
  const outcomes = await Promise.allSettled([
    newPost(boardId),
    voteOnPost(postId, await freshVoter()),
    newComment(postId),
  ])
  for (const outcome of outcomes) {
    if (open) expect(outcome.status).toBe('fulfilled')
    else
      expect(outcome).toMatchObject({ status: 'rejected', reason: expect.any(BoardReadOnlyError) })
  }
}

async function votesOn(postId: PostId) {
  const [row] = await testDb
    .select({ n: count() })
    .from(postVotes)
    .where(eq(postVotes.postId, postId))
  const [post] = await testDb
    .select({ voteCount: posts.voteCount })
    .from(posts)
    .where(eq(posts.id, postId))
  return { rows: row?.n ?? 0, voteCount: post?.voteCount ?? 0 }
}

describe.skipIf(!fixture.available)('read-only boards, edges (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    usage.fail = false
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (!row) {
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    }
    await testDb.update(settings).set({ planLimitsState: null })
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb
      .update(principal)
      .set({ role: 'user' })
      .where(inArray(principal.role, ['admin', 'member']))
    const ownerUser = createId('user') as UserId
    voterUserId = createId('user') as UserId
    ownerId = createId('principal') as PrincipalId
    voterId = createId('principal') as PrincipalId
    await testDb.insert(user).values([
      { id: ownerUser, name: 'Acme Owner', email: `${ownerUser}@example.com` },
      { id: voterUserId, name: 'Acme Voter', email: `${voterUserId}@example.com` },
    ])
    await testDb.insert(principal).values([
      { id: ownerId, userId: ownerUser, role: 'admin', type: 'user', createdAt: new Date() },
      { id: voterId, userId: voterUserId, role: 'user', type: 'user', createdAt: new Date() },
    ])
    adminActor = {
      principalId: ownerId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(),
    }
    const open = await addBoard('Acme open', 3, new Date('2026-02-01T00:00:00.000Z'))
    const closed = await addBoard('Acme closed', 1, new Date('2026-01-01T00:00:00.000Z'))
    openBoard = open.id
    closedBoard = closed.id
    closedPost = closed.postIds[0]
  })
  afterEach(async () => {
    vi.useRealTimers()
    usage.fail = false
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  describe('a refused vote writes nothing', () => {
    it('for a vote and a vote on behalf on a board the plan keeps read-only', async () => {
      await enforce()
      const before = await votesOn(closedPost)
      await expect(voteOnPost(closedPost, voterId)).rejects.toBeInstanceOf(BoardReadOnlyError)
      await expect(addVoteOnBehalf(closedPost, voterId)).rejects.toBeInstanceOf(BoardReadOnlyError)
      expect(await votesOn(closedPost)).toEqual(before)
    })

    it('for a vote and a vote on behalf on a board an admin set read-only', async () => {
      await configure(false)
      await testDb.update(boards).set({ readOnly: true }).where(eq(boards.id, closedBoard))
      const before = await votesOn(closedPost)
      await expect(voteOnPost(closedPost, voterId)).rejects.toBeInstanceOf(BoardReadOnlyError)
      await expect(addVoteOnBehalf(closedPost, voterId)).rejects.toBeInstanceOf(BoardReadOnlyError)
      expect(await votesOn(closedPost)).toEqual(before)
    })
  })

  describe('the end of the grace', () => {
    it('keeps the board open until the instant graceEndsAt, and closes it at that instant', async () => {
      await configure(true)
      const { graceEndsAt } = await getPlanLimits()
      const end = Date.parse(graceEndsAt!)
      vi.useFakeTimers({ toFake: ['Date'], now: end - 1 })
      await expectEveryPath(closedBoard, closedPost, true)
      vi.setSystemTime(end)
      await expectEveryPath(closedBoard, closedPost, false)
    })
  })

  describe('coming back', () => {
    it('reopens every board at once on an upgrade, with every post and vote kept', async () => {
      await enforce()
      await expect(newPost(closedBoard)).rejects.toBeInstanceOf(BoardReadOnlyError)
      const postsBefore = await testDb
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.boardId, closedBoard))
      await configure(true, OSS_TIER_LIMITS)
      expect((await getPlanLimits()).phase).toBe('ok')
      const postsAfter = await testDb
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.boardId, closedBoard))
      expect(postsAfter.map((p) => p.id).sort()).toEqual(postsBefore.map((p) => p.id).sort())
      await expectEveryPath(closedBoard, closedPost, true)
      await expectEveryPath(openBoard, closedPost, true)
    })

    it('reopens on a fix: removing the extra board leaves the open board open and ok', async () => {
      await enforce()
      const third = await addBoard('Acme third', 0, new Date('2026-03-01T00:00:00.000Z'))
      await invalidatePlanLimits()
      await expect(newPost(third.id)).rejects.toBeInstanceOf(BoardReadOnlyError)
      // A partial fix (one of two extra boards gone) still leaves one read-only.
      await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, third.id))
      await invalidatePlanLimits()
      await expect(newPost(closedBoard)).rejects.toBeInstanceOf(BoardReadOnlyError)
      await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, closedBoard))
      await invalidatePlanLimits()
      expect((await getPlanLimits()).phase).toBe('ok')
      await expect(newPost(openBoard)).resolves.toBeDefined()
    })
  })

  describe('an install without plan billing', () => {
    it('never closes a board with the rules on and no board cap, however many boards', async () => {
      await addBoard('Acme third', 2, new Date('2026-03-01T00:00:00.000Z'))
      await configure(true, OSS_TIER_LIMITS)
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 30 * DAY })
      expect((await getPlanLimits()).phase).toBe('ok')
      await expectEveryPath(closedBoard, closedPost, true)
      const [row] = await testDb.select({ state: settings.planLimitsState }).from(settings)
      expect(row?.state ?? null).toBeNull()
    })
  })

  describe('a failed plan limits read', () => {
    it('opens a board the plan would keep read-only', async () => {
      await enforce()
      await expect(newPost(closedBoard)).rejects.toBeInstanceOf(BoardReadOnlyError)
      usage.fail = true
      await invalidatePlanLimits()
      await expect(getPlanLimits()).rejects.toThrow('usage count failed')
      await expectEveryPath(closedBoard, closedPost, true)
    })

    it('still refuses a board an admin set read-only', async () => {
      await enforce()
      await testDb.update(boards).set({ readOnly: true }).where(eq(boards.id, openBoard))
      usage.fail = true
      await invalidatePlanLimits()
      const [post] = await testDb
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.boardId, openBoard))
        .limit(1)
      await expectEveryPath(openBoard, post!.id, false)
    })
  })

  describe('the posts cap for a visitor', () => {
    async function capAtCurrentCount() {
      const [row] = await testDb.select({ n: count() }).from(posts).where(isNull(posts.deletedAt))
      return { ...OSS_TIER_LIMITS, maxPosts: row?.n ?? 0 }
    }
    const visitorAuth = () =>
      ({
        user: { id: voterUserId, name: 'Acme Voter', email: `${voterUserId}@example.com` },
        principal: { id: voterId, role: 'user', type: 'user' },
        permissions: [],
      }) as unknown as Parameters<typeof runCreatePublicPost>[0]

    it('gives a portal or widget visitor the neutral line with the rules on', async () => {
      await configure(true, await capAtCurrentCount())
      const error = await runCreatePublicPost(visitorAuth(), {
        boardId: openBoard,
        title: 'Acme idea',
        content: 'Details',
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BoardReadOnlyError)
      expect((error as Error).message).toBe(BOARD_READ_ONLY_MESSAGE)
    })

    it('leaves a different plan cap refusal as it is', async () => {
      await configure(true)
      const boardsCap = new TierLimitError({
        limit: 'maxBoards',
        current: 2,
        max: 1,
        message: 'Upgrade to add more boards.',
      })
      await expect(
        withVisitorPostCapCopy(async () => {
          throw boardsCap
        })
      ).rejects.toBe(boardsCap)
    })
  })

  it('does not count a vote on a different post as the refused one', async () => {
    await enforce()
    const [openPost] = await testDb
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.boardId, openBoard), isNull(posts.deletedAt)))
      .limit(1)
    await expect(voteOnPost(openPost!.id, voterId)).resolves.toMatchObject({ voted: true })
    expect((await votesOn(openPost!.id)).rows).toBe(1)
  })
})
