/**
 * An internal post reaches no reader outside the team feedback console, and
 * causes no fan-out.
 *
 * `postViewFilter` and `canViewPost` are proved over the audience axis in
 * policy/__tests__/post-audience.test.ts and post-view-filter-parity.test.ts.
 * What those cannot prove is that every reader actually composes them: a
 * dozen readers in this tree hand-roll their own predicate because they have
 * no actor (the sitemap, the changelog's public reader, the roadmap's team
 * branch) or because they own a ceiling of their own (Quinn's retrieval).
 * Each case below drives the real reader against real rows.
 *
 * Both posts in every case are published, on the same fully public board, by
 * the same principal, and differ only in `audience`. So a case that passes
 * because the seed was invisible for some other reason cannot pass at all:
 * the board post must be found by the same call.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostId,
  type PostStatusId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, postStatuses, principal, user, type PostAudience } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicPosts } from '../post.public'
import { getPublicPostDetail } from '../post.public.detail'
import { getPublicRoadmapPostsPaginated } from '../post.public.utils'
import { listPostsForExport } from '../post.export'
import { listInboxPosts } from '../post.inbox'
import { getPostWithDetails } from '../post.query'
import { assertPostOnBoardAudience, assertPostViewable } from '../post.access'
import { listPublicBoardsWithStats } from '../../boards/board.public'
import { postsVisibilityConditions } from '../../assistant/posts-retrieval'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, audience: posts.audience }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** The customer the capture is attributed to. Their own actor is the hard case. */
let customerPrincipalId: PrincipalId
let teamPrincipalId: PrincipalId
let boardId: BoardId
let boardSlug: string
let statusId: PostStatusId
let boardPostId: PostId
let internalPostId: PostId

function actorFor(principalId: PrincipalId, role: Actor['role']): Actor {
  return { principalId, role, principalType: 'user', segmentIds: new Set() }
}

const anonymousActor: Actor = {
  principalId: null,
  role: null,
  principalType: 'anonymous',
  segmentIds: new Set(),
}

async function seedPrincipal(role: 'admin' | 'user', name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email: `${suffix()}@example.test` })
  await testDb
    .insert(principal)
    .values({
      id: principalId,
      userId,
      role,
      type: 'user',
      displayName: name,
      createdAt: new Date(),
    })
  return principalId
}

async function seedPost(audience: PostAudience, title: string): Promise<PostId> {
  const [row] = await testDb
    .insert(posts)
    .values({
      boardId,
      statusId,
      title,
      content: `${title} body`,
      principalId: customerPrincipalId,
      moderationState: 'published',
      audience,
      voteCount: audience === 'internal' ? 0 : 1,
    })
    .returning()
  return row.id
}

describe.skipIf(!fixture.available)('the internal audience across every reader (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    customerPrincipalId = await seedPrincipal('user', 'Maya')
    teamPrincipalId = await seedPrincipal('admin', 'Product')
    boardSlug = `aud-${suffix()}`
    const [board] = await testDb
      .insert(boards)
      .values({ slug: boardSlug, name: 'Audience board', access: DEFAULT_BOARD_ACCESS })
      .returning()
    boardId = board.id
    const [status] = await testDb
      .insert(postStatuses)
      .values({ slug: `open-${suffix()}`, name: 'Open', color: '#000000', position: 1 })
      .returning()
    statusId = status.id
    boardPostId = await seedPost('board', 'Board visible request')
    internalPostId = await seedPost('internal', 'Internal captured evidence')
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('the attributed customer', () => {
    it('does not see their own capture in the public list, but does see the board post', async () => {
      const result = await listPublicPosts({
        boardSlug,
        actor: actorFor(customerPrincipalId, 'user'),
      })
      const ids = result.items.map((p) => p.id)
      expect(ids).toContain(boardPostId)
      expect(ids).not.toContain(internalPostId)
    })

    it('cannot open its detail page', async () => {
      const actor = actorFor(customerPrincipalId, 'user')
      await expect(getPublicPostDetail(boardPostId, actor)).resolves.not.toBeNull()
      await expect(getPublicPostDetail(internalPostId, actor)).resolves.toBeNull()
    })

    it('cannot reach it through the write chokepoint either', async () => {
      const actor = actorFor(customerPrincipalId, 'user')
      await expect(assertPostViewable(boardPostId, actor)).resolves.toBeUndefined()
      await expect(assertPostViewable(internalPostId, actor)).rejects.toThrow(/not found/i)
    })
  })

  describe('other customers and anonymous readers', () => {
    it('are not shown it in the public list', async () => {
      for (const actor of [
        anonymousActor,
        actorFor(await seedPrincipal('user', 'Other'), 'user'),
      ]) {
        const result = await listPublicPosts({ boardSlug, actor })
        const ids = result.items.map((p) => p.id)
        expect(ids).toContain(boardPostId)
        expect(ids).not.toContain(internalPostId)
      }
    })

    it('are not shown it in the board post count', async () => {
      const boardsForAnon = await listPublicBoardsWithStats(anonymousActor)
      const row = boardsForAnon.find((b) => b.slug === boardSlug)
      expect(row?.postCount).toBe(1)
    })

    it('are not shown it on the roadmap', async () => {
      const page = await getPublicRoadmapPostsPaginated({ statusId, actor: anonymousActor })
      const ids = page.items.map((p) => p.id)
      expect(ids).toContain(boardPostId)
      expect(ids).not.toContain(internalPostId)
    })
  })

  describe('a teammate holding the private-post capability', () => {
    it('sees it in the detail reader', async () => {
      const actor = actorFor(teamPrincipalId, 'admin')
      const detail = await getPublicPostDetail(internalPostId, actor)
      expect(detail?.id).toBe(internalPostId)
    })

    it('sees it in the admin feedback list, and can narrow to one audience', async () => {
      const all = await listInboxPosts({ boardIds: [boardId] })
      expect(all.items.map((p) => p.id).sort()).toEqual([boardPostId, internalPostId].sort())

      const internalOnly = await listInboxPosts({ boardIds: [boardId], audience: 'internal' })
      expect(internalOnly.items.map((p) => p.id)).toEqual([internalPostId])

      const boardOnly = await listInboxPosts({ boardIds: [boardId], audience: 'board' })
      expect(boardOnly.items.map((p) => p.id)).toEqual([boardPostId])
    })
  })

  describe('the published contract surfaces', () => {
    it('the REST and MCP detail reader refuses it by audience', async () => {
      await expect(getPostWithDetails(boardPostId, { audience: 'board' })).resolves.toMatchObject({
        id: boardPostId,
      })
      await expect(getPostWithDetails(internalPostId, { audience: 'board' })).rejects.toThrow(
        /not found/i
      )
    })

    it('the sub-resource guard refuses it and admits the board post', async () => {
      await expect(assertPostOnBoardAudience(boardPostId)).resolves.toBeUndefined()
      await expect(assertPostOnBoardAudience(internalPostId)).rejects.toThrow(/not found/i)
    })

    it('the feedback export leaves it out', async () => {
      const rows = await listPostsForExport(boardId)
      expect(rows.map((r) => r.id)).toEqual([boardPostId])
    })
  })

  describe("Quinn's retrieval ceilings", () => {
    /** Run the shared visibility predicate the way both retrieval queries do. */
    async function visibleAt(ceiling: 'public' | 'team'): Promise<PostId[]> {
      const { and, eq } = await import('drizzle-orm')
      const rows = await testDb
        .select({ id: posts.id })
        .from(posts)
        .innerJoin(boards, eq(posts.boardId, boards.id))
        .where(and(eq(posts.boardId, boardId), ...postsVisibilityConditions(ceiling)))
      return rows.map((r) => r.id)
    }

    it('never grounds a customer-facing answer on it', async () => {
      const ids = await visibleAt('public')
      expect(ids).toContain(boardPostId)
      expect(ids).not.toContain(internalPostId)
    })

    it('still lets the team ceiling read it for product analysis', async () => {
      const ids = await visibleAt('team')
      expect(ids).toContain(internalPostId)
    })
  })
})
