/**
 * Read-only boards against a real database: every service that writes a post,
 * a vote or a comment refuses a board that is not kept open once the grace has
 * ended, and allows it in grace, when the board is kept, and with the flag off.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostId,
  type PrincipalId,
  type UserId,
  type WorkspaceId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  inArray,
  invitation,
  isNull,
  posts,
  principal,
  settings,
  user,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import type { Actor } from '@/lib/server/policy/types'

const dispatch = vi.hoisted(() => ({
  dispatchPostCreated: vi.fn(),
  dispatchPostVoted: vi.fn(),
  dispatchCommentCreated: vi.fn(),
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  ...dispatch,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { runFetchBoardCapabilities } from '@/lib/server/functions/portal'
import { createPost } from '@/lib/server/domains/posts/post.service'
import { voteOnPost, addVoteOnBehalf } from '@/lib/server/domains/posts/post.voting'
import { changeBoard } from '@/lib/server/domains/posts/post.board'
import { createComment } from '@/lib/server/domains/comments/comment.service'
import { processBatch } from '@/lib/server/domains/import/import-service'
import { ImportUserResolver } from '@/lib/server/domains/import/user-resolver'
import { getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'
import { setKeptBoard } from '../plan-limits.choosers'
import {
  BOARD_READ_ONLY_MESSAGE,
  BoardReadOnlyError,
  assertBoardOpen,
  withVisitorPostCapCopy,
} from '../plan-limits.board-guard'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

const FREE_LIKE = { ...OSS_TIER_LIMITS, maxBoards: 1 }

let settingsId: WorkspaceId
let ownerId: PrincipalId
let voterId: PrincipalId
let adminActor: Actor
let openBoard: BoardId
let closedBoard: BoardId
let openPost: PostId
let closedPost: PostId

async function configure(options: { planLimits: boolean; tierLimits?: Record<string, unknown> }) {
  await testDb
    .update(settings)
    .set({
      featureFlags: JSON.stringify({ feedback: true, planLimits: options.planLimits }),
      tierLimits: JSON.stringify(options.tierLimits ?? FREE_LIKE),
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
}

/** First detection now, then the clock moves past the 7 day grace. */
async function enforce() {
  await configure({ planLimits: true })
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
const newComment = (postId: PostId, isPrivate = false) =>
  createComment(
    { postId, content: 'Acme comment', isPrivate },
    { principalId: ownerId, role: 'admin' },
    adminActor,
    { skipDispatch: true }
  )

describe.skipIf(!fixture.available)('read-only boards (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    settingsId =
      row?.id ??
      (
        await testDb
          .insert(settings)
          .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
          .returning({ id: settings.id })
      )[0]!.id
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb
      .update(principal)
      .set({ role: 'user' })
      .where(inArray(principal.role, ['admin', 'member']))
    await testDb
      .update(invitation)
      .set({ status: 'canceled' })
      .where(eq(invitation.status, 'pending'))
    const ownerUser = createId('user') as UserId
    const voterUser = createId('user') as UserId
    ownerId = createId('principal') as PrincipalId
    voterId = createId('principal') as PrincipalId
    await testDb.insert(user).values([
      { id: ownerUser, name: 'Acme Owner', email: `${ownerUser}@example.com` },
      { id: voterUser, name: 'Acme Voter', email: `${voterUser}@example.com` },
    ])
    await testDb.insert(principal).values([
      { id: ownerId, userId: ownerUser, role: 'admin', type: 'user', createdAt: new Date() },
      { id: voterId, userId: voterUser, role: 'user', type: 'user', createdAt: new Date() },
    ])
    adminActor = {
      principalId: ownerId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(),
    }
    // The bigger board stays open by default.
    const open = await addBoard('Acme open', 3, new Date('2026-02-01T00:00:00.000Z'))
    const closed = await addBoard('Acme closed', 1, new Date('2026-01-01T00:00:00.000Z'))
    openBoard = open.id
    closedBoard = closed.id
    openPost = open.postIds[0]
    closedPost = closed.postIds[0]
    dispatch.dispatchPostCreated.mockClear()
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  describe('after the grace, on a board that is not kept open', () => {
    beforeEach(enforce)

    it('refuses a new post', async () => {
      await expect(newPost(closedBoard)).rejects.toBeInstanceOf(BoardReadOnlyError)
    })

    it('refuses a vote and a vote on behalf', async () => {
      await expect(voteOnPost(closedPost, voterId)).rejects.toBeInstanceOf(BoardReadOnlyError)
      await expect(addVoteOnBehalf(closedPost, voterId)).rejects.toBeInstanceOf(BoardReadOnlyError)
    })

    it('refuses a public comment and a team note', async () => {
      await expect(newComment(closedPost)).rejects.toBeInstanceOf(BoardReadOnlyError)
      await expect(newComment(closedPost, true)).rejects.toBeInstanceOf(BoardReadOnlyError)
    })

    it('refuses a vote on a post merged into a post on that board', async () => {
      const mergedId = createId('post') as PostId
      await testDb.insert(posts).values({
        id: mergedId,
        boardId: openBoard,
        title: 'Acme duplicate',
        content: '',
        principalId: ownerId,
        canonicalPostId: closedPost,
      })
      await expect(voteOnPost(mergedId, voterId)).rejects.toBeInstanceOf(BoardReadOnlyError)
    })

    it('words the refusal neutrally, with no mention of plans or billing', async () => {
      const error = await newPost(closedBoard).catch((e: unknown) => e as Error)
      expect(error).toBeInstanceOf(BoardReadOnlyError)
      expect((error as Error).message).toBe(BOARD_READ_ONLY_MESSAGE)
      expect((error as Error).message).not.toMatch(/plan|upgrade|billing|limit/i)
    })

    it('refuses import rows aimed at the board and imports the rest', async () => {
      const resolver = new ImportUserResolver()
      const result = await processBatch(
        [
          { title: 'Acme one', content: 'x', author_name: 'Acme Fan', board: closedBoard },
          { title: 'Acme two', content: 'x', author_name: 'Acme Fan', board: openBoard },
        ],
        openBoard,
        0,
        resolver
      )
      expect(result.imported).toBe(1)
      expect(result.errors.map((e) => e.message)).toEqual([BOARD_READ_ONLY_MESSAGE])
    })

    it('keeps an imported post on a read-only board as it was when it is imported again', async () => {
      // Imported while open, then the board went read-only: a re-import with the
      // same source id must not change it.
      await testDb
        .update(settings)
        .set({ planLimitsState: null })
        .where(eq(settings.id, settingsId))
      vi.useRealTimers()
      await invalidatePlanLimits()
      await configure({ planLimits: false })
      const row = {
        title: 'Acme first',
        content: 'x',
        author_name: 'Acme Fan',
        board: closedBoard,
        source_id: 'src-1',
      }
      await processBatch([row], openBoard, 0, new ImportUserResolver())
      await enforce()
      const again = await processBatch(
        [{ ...row, title: 'Acme changed' }],
        openBoard,
        0,
        new ImportUserResolver()
      )
      expect(again.updated).toBe(0)
      expect(again.errors.map((e) => e.message)).toEqual([BOARD_READ_ONLY_MESSAGE])
      const [kept] = await testDb.select().from(posts).where(eq(posts.title, 'Acme first'))
      expect(kept).toBeDefined()
    })

    it('still allows the open board to take a post, a vote and a comment', async () => {
      await expect(newPost(openBoard)).resolves.toMatchObject({ boardId: openBoard })
      await expect(voteOnPost(openPost, voterId)).resolves.toMatchObject({ voted: true })
      await expect(newComment(openPost)).resolves.toBeDefined()
    })

    it('lets an admin move a post into the open board', async () => {
      await expect(
        changeBoard(closedPost, openBoard, { principalId: ownerId })
      ).resolves.toBeDefined()
      const [moved] = await testDb.select().from(posts).where(eq(posts.id, closedPost))
      expect(moved.boardId).toBe(openBoard)
    })

    it('does not let a post be moved into a read-only board', async () => {
      await expect(
        changeBoard(openPost, closedBoard, { principalId: ownerId })
      ).rejects.toBeInstanceOf(BoardReadOnlyError)
    })
  })

  it('allows every create path once the admin keeps the board open', async () => {
    await configure({ planLimits: true })
    expect(await setKeptBoard(closedBoard)).toEqual({ ok: true })
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    await expect(newPost(closedBoard)).resolves.toBeDefined()
    await expect(voteOnPost(closedPost, voterId)).resolves.toBeDefined()
    await expect(newComment(closedPost)).resolves.toBeDefined()
    await expect(newPost(openBoard)).rejects.toBeInstanceOf(BoardReadOnlyError)
  })

  it('allows every create path during the grace', async () => {
    await configure({ planLimits: true })
    expect((await getPlanLimits()).phase).toBe('grace')
    await expect(
      changeBoard(openPost, closedBoard, { principalId: ownerId })
    ).resolves.toBeDefined()
    const imported = await processBatch(
      [{ title: 'Acme one', content: 'x', author_name: 'Acme Fan', board: closedBoard }],
      openBoard,
      0,
      new ImportUserResolver()
    )
    expect(imported).toMatchObject({ imported: 1, errors: [] })
    await expect(newPost(closedBoard)).resolves.toBeDefined()
    await expect(voteOnPost(closedPost, voterId)).resolves.toBeDefined()
    await expect(addVoteOnBehalf(closedPost, ownerId)).resolves.toBeDefined()
    await expect(newComment(closedPost)).resolves.toBeDefined()
  })

  it('is inert with the flag off, even long past the first detection', async () => {
    await enforce()
    await configure({ planLimits: false })
    await expect(addVoteOnBehalf(closedPost, voterId)).resolves.toBeDefined()
    await expect(
      changeBoard(openPost, closedBoard, { principalId: ownerId })
    ).resolves.toBeDefined()
    const imported = await processBatch(
      [{ title: 'Acme one', content: 'x', author_name: 'Acme Fan', board: closedBoard }],
      openBoard,
      0,
      new ImportUserResolver()
    )
    expect(imported).toMatchObject({ imported: 1, errors: [] })
    await expect(assertBoardOpen(closedBoard)).resolves.toBeUndefined()
    await expect(newPost(closedBoard)).resolves.toBeDefined()
    await expect(voteOnPost(closedPost, voterId)).resolves.toBeDefined()
    await expect(newComment(closedPost)).resolves.toBeDefined()
  })

  describe('what the portal and widget are told', () => {
    beforeEach(async () => {
      const open = {
        ...DEFAULT_BOARD_ACCESS,
        view: 'anonymous' as const,
        vote: 'anonymous' as const,
        comment: 'anonymous' as const,
        submit: 'anonymous' as const,
      }
      await testDb
        .update(boards)
        .set({ access: open })
        .where(inArray(boards.id, [openBoard, closedBoard]))
      await testDb
        .update(settings)
        .set({ portalConfig: JSON.stringify({ features: { allowAnonymous: true } }) })
        .where(eq(settings.id, settingsId))
      await invalidateSettingsCache()
    })

    it('marks a read-only board, closes its votes and posts, and points at the open board', async () => {
      await enforce()
      const { permissions } = await runFetchBoardCapabilities(null)
      expect(permissions[closedBoard]).toEqual({
        canSubmit: false,
        canVote: false,
        readOnly: true,
        shareBoardId: openBoard,
      })
      expect(permissions[openBoard]).toEqual({ canSubmit: true, canVote: true })
    })

    it('points a visitor who must sign in first at the open board anyway', async () => {
      await testDb
        .update(boards)
        .set({
          access: {
            ...DEFAULT_BOARD_ACCESS,
            view: 'anonymous',
            vote: 'authenticated',
            submit: 'authenticated',
          },
        })
        .where(inArray(boards.id, [openBoard, closedBoard]))
      await enforce()
      const { permissions } = await runFetchBoardCapabilities(null)
      expect(permissions[openBoard]?.canSubmit).toBe(false)
      expect(permissions[closedBoard]).toMatchObject({ readOnly: true, shareBoardId: openBoard })
    })

    it('offers no board to post to at exactly the posts cap, where a post is refused', async () => {
      await configure({ planLimits: true, tierLimits: { ...FREE_LIKE, maxPosts: 4 } })
      await getPlanLimits()
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
      const { permissions } = await runFetchBoardCapabilities(null)
      expect(permissions[closedBoard]).toMatchObject({ readOnly: true, shareBoardId: null })
    })

    it('offers no board to post to while new posts are stopped at the posts cap', async () => {
      await configure({
        planLimits: true,
        tierLimits: { ...FREE_LIKE, maxPosts: 1 },
      })
      await getPlanLimits()
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
      const { permissions } = await runFetchBoardCapabilities(null)
      expect(permissions[closedBoard]).toMatchObject({ readOnly: true, shareBoardId: null })
    })

    it('says nothing about read-only boards in grace or with the flag off', async () => {
      await configure({ planLimits: true })
      expect((await runFetchBoardCapabilities(null)).permissions[closedBoard]).toEqual({
        canSubmit: true,
        canVote: true,
      })
      await configure({ planLimits: false })
      expect((await runFetchBoardCapabilities(null)).permissions[closedBoard]).toEqual({
        canSubmit: true,
        canVote: true,
      })
    })

    it('never puts plan words in what it sends', async () => {
      await enforce()
      const { permissions } = await runFetchBoardCapabilities(null)
      expect(JSON.stringify(permissions)).not.toMatch(/plan|upgrade|billing|limit|tier/i)
    })
  })

  describe('import under the caps', () => {
    const rows = (n: number, extra: Record<string, string> = {}) =>
      Array.from({ length: n }, (_, i) => ({
        title: `Acme import ${i}`,
        content: 'x',
        author_name: 'Acme Fan',
        ...extra,
      }))

    it('stops new posts at the posts cap', async () => {
      // Four posts exist; a cap of five leaves room for one.
      await configure({ planLimits: true, tierLimits: { ...OSS_TIER_LIMITS, maxPosts: 5 } })
      const result = await processBatch(rows(3), openBoard, 0, new ImportUserResolver())
      expect(result.imported).toBe(1)
      expect(result.errors).toHaveLength(2)
      expect(result.skipped).toBe(2)
    })

    it('does not create a board past the boards cap, and refuses the rows that needed it', async () => {
      await configure({ planLimits: true, tierLimits: { ...OSS_TIER_LIMITS, maxBoards: 2 } })
      const result = await processBatch(
        rows(1, { board: 'Acme brand new' }),
        openBoard,
        0,
        new ImportUserResolver()
      )
      expect(result.createdBoards).toEqual([])
      expect(result.imported).toBe(0)
      expect(result.errors).toHaveLength(1)
    })

    it('is unlimited with the flag off', async () => {
      await configure({ planLimits: false, tierLimits: { ...OSS_TIER_LIMITS, maxPosts: 5 } })
      const result = await processBatch(rows(3), openBoard, 0, new ImportUserResolver())
      expect(result.imported).toBe(3)
    })
  })

  describe('the posts cap copy', () => {
    const capped = () => {
      throw new TierLimitError({
        limit: 'maxPosts',
        current: 50,
        max: 50,
        message: "You've reached your plan's posts limit (50). Upgrade to add more.",
      })
    }

    it('gives a visitor the neutral line with the flag on', async () => {
      await configure({ planLimits: true })
      const error = await withVisitorPostCapCopy(capped).catch((e: unknown) => e as Error)
      expect(error).toBeInstanceOf(BoardReadOnlyError)
      expect((error as Error).message).toBe(BOARD_READ_ONLY_MESSAGE)
    })

    it('leaves the upgrade wording alone with the flag off', async () => {
      await configure({ planLimits: false })
      await expect(withVisitorPostCapCopy(capped)).rejects.toBeInstanceOf(TierLimitError)
    })

    it('passes every other error through', async () => {
      await configure({ planLimits: true })
      const other = new Error('boom')
      await expect(
        withVisitorPostCapCopy(async () => {
          throw other
        })
      ).rejects.toBe(other)
    })
  })
})
