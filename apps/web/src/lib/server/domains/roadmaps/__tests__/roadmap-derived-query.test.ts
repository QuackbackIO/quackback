import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostId,
  type PostStatusId,
  type PostTagId,
  type PrincipalId,
  type RoadmapId,
  type SegmentId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  postStatuses,
  postTagAssignments,
  postTags,
  posts,
  principal,
  roadmapColumns,
  roadmaps,
  segments,
  user,
  userSegments,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS, type BoardAccess } from '@/lib/shared/db-types'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy'
import { getPublicRoadmapPosts, getRoadmapPosts } from '../roadmap.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roadmaps.id, type: roadmaps.type }).from(roadmaps).limit(0)
    await db.select({ id: roadmapColumns.id }).from(roadmapColumns).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function boardAccess(view: BoardAccess['view']): BoardAccess {
  return {
    ...DEFAULT_BOARD_ACCESS,
    view,
    vote: view,
    comment: view,
    submit: view,
  }
}

function actor(overrides: Partial<Actor>): Actor {
  return {
    principalId: null,
    role: null,
    principalType: 'user',
    segmentIds: new Set(),
    ...overrides,
  }
}

interface Seeded {
  boardA: BoardId
  boardB: BoardId
  deletedBoard: BoardId
  statusA: PostStatusId
  statusB: PostStatusId
  tagA: PostTagId
  segmentA: SegmentId
  authorA: PrincipalId
  authorB: PrincipalId
}

async function seedPrincipal(name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

async function seedBase(): Promise<Seeded> {
  const authorA = await seedPrincipal(`Roadmap author A ${suffix()}`)
  const authorB = await seedPrincipal(`Roadmap author B ${suffix()}`)
  const [boardA] = await testDb
    .insert(boards)
    .values({ slug: `roadmap-a-${suffix()}`, name: 'A', access: boardAccess('anonymous') })
    .returning()
  const [boardB] = await testDb
    .insert(boards)
    .values({ slug: `roadmap-b-${suffix()}`, name: 'B', access: boardAccess('team') })
    .returning()
  const [deletedBoard] = await testDb
    .insert(boards)
    .values({
      slug: `roadmap-deleted-${suffix()}`,
      name: 'Deleted',
      access: boardAccess('anonymous'),
      deletedAt: new Date(),
    })
    .returning()
  const [statusA] = await testDb
    .insert(postStatuses)
    .values({ name: 'Roadmap A', slug: `roadmap-a-${suffix()}`, color: '#123456' })
    .returning()
  const [statusB] = await testDb
    .insert(postStatuses)
    .values({ name: 'Roadmap B', slug: `roadmap-b-${suffix()}`, color: '#654321' })
    .returning()
  const [tagA] = await testDb
    .insert(postTags)
    .values({ name: `Roadmap tag ${suffix()}` })
    .returning()
  const [segmentA] = await testDb
    .insert(segments)
    .values({ name: 'Roadmap segment', slug: `roadmap-segment-${suffix()}` })
    .returning()
  await testDb.insert(userSegments).values({ principalId: authorA, segmentId: segmentA.id })
  return {
    boardA: boardA.id,
    boardB: boardB.id,
    deletedBoard: deletedBoard.id,
    statusA: statusA.id,
    statusB: statusB.id,
    tagA: tagA.id,
    segmentA: segmentA.id,
    authorA,
    authorB,
  }
}

async function seedRoadmap(
  seeded: Seeded,
  input: Partial<typeof roadmaps.$inferInsert> & { type?: 'column' | 'date' }
): Promise<RoadmapId> {
  const type = input.type ?? 'column'
  const [roadmap] = await testDb
    .insert(roadmaps)
    .values({
      slug: `roadmap-view-${suffix()}`,
      name: 'Roadmap view',
      type,
      baseFilter: {},
      dateSource: type === 'date' ? 'eta' : null,
      frequency: type === 'date' ? 'monthly' : null,
      visibility: 'public',
      ...input,
    })
    .returning()
  if (type === 'column') {
    await testDb.insert(roadmapColumns).values([
      {
        roadmapId: roadmap.id,
        statusId: seeded.statusA,
        name: 'A',
        color: '#123456',
        position: 0,
      },
      {
        roadmapId: roadmap.id,
        statusId: seeded.statusB,
        name: 'B',
        color: '#654321',
        position: 1,
      },
    ])
  }
  return roadmap.id
}

async function seedPost(
  seeded: Seeded,
  overrides: Partial<typeof posts.$inferInsert> = {}
): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: seeded.boardA,
      title: `Roadmap post ${suffix()}`,
      content: '',
      principalId: seeded.authorA,
      statusId: seeded.statusA,
      ...overrides,
    })
    .returning()
  return post.id
}

describe.skipIf(!fixture.available)('roadmap derived membership (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('derives exclusive status-column membership and applies every base filter', async () => {
    const seeded = await seedBase()
    const roadmapId = await seedRoadmap(seeded, {
      baseFilter: {
        statusIds: [seeded.statusA],
        boardIds: [seeded.boardA],
        tagIds: [seeded.tagA],
        segmentIds: [seeded.segmentA],
      },
    })
    const target = await seedPost(seeded)
    await testDb.insert(postTagAssignments).values({ postId: target, tagId: seeded.tagA })

    const wrongStatus = await seedPost(seeded, { statusId: seeded.statusB })
    const wrongBoard = await seedPost(seeded, { boardId: seeded.boardB })
    const wrongTag = await seedPost(seeded)
    const wrongSegment = await seedPost(seeded, { principalId: seeded.authorB })
    await testDb.insert(postTagAssignments).values([
      { postId: wrongStatus, tagId: seeded.tagA },
      { postId: wrongBoard, tagId: seeded.tagA },
      { postId: wrongSegment, tagId: seeded.tagA },
    ])

    const columnA = await getRoadmapPosts(roadmapId, { statusId: seeded.statusA })
    expect(columnA.items.map((post) => post.id)).toEqual([target])

    const columnB = await getRoadmapPosts(roadmapId, { statusId: seeded.statusB })
    expect(columnB.items).toEqual([])
    expect([wrongStatus, wrongBoard, wrongTag, wrongSegment]).not.toContain(target)
  })

  it.each([
    ['monthly' as const, '2026-04', '2026-04-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'],
    ['quarterly' as const, '2026-Q2', '2026-04-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
    ['semiannual' as const, '2026-H1', '2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
  ])('buckets %s ETAs with UTC half-open boundaries', async (frequency, bucketId, start, end) => {
    const seeded = await seedBase()
    const roadmapId = await seedRoadmap(seeded, {
      type: 'date',
      frequency,
      baseFilter: { boardIds: [seeded.boardA] },
    })
    const atStart = await seedPost(seeded, { eta: new Date(start) })
    const beforeEnd = await seedPost(seeded, { eta: new Date(new Date(end).getTime() - 1) })
    const atEnd = await seedPost(seeded, { eta: new Date(end) })

    const result = await getRoadmapPosts(roadmapId, { bucketId, limit: 20 })
    expect(new Set(result.items.map((post) => post.id))).toEqual(new Set([atStart, beforeEnd]))
    expect(result.items.map((post) => post.id)).not.toContain(atEnd)
  })

  it('keeps null ETA posts in the final No ETA bucket', async () => {
    const seeded = await seedBase()
    const roadmapId = await seedRoadmap(seeded, {
      type: 'date',
      frequency: 'monthly',
      baseFilter: { boardIds: [seeded.boardA] },
    })
    const noEta = await seedPost(seeded, { eta: null })
    await seedPost(seeded, { eta: new Date('2026-07-01T00:00:00.000Z') })

    const result = await getRoadmapPosts(roadmapId, { bucketId: 'no-eta' })
    expect(result.items.map((post) => post.id)).toEqual([noEta])
  })

  it('preserves moderation, deleted-board, merged-post, and board audience gates', async () => {
    const seeded = await seedBase()
    const roadmapId = await seedRoadmap(seeded, {})
    const visible = await seedPost(seeded)
    await seedPost(seeded, { moderationState: 'pending' })
    await seedPost(seeded, { boardId: seeded.boardB })
    await seedPost(seeded, { boardId: seeded.deletedBoard })
    const canonical = await seedPost(seeded)
    const merged = await seedPost(seeded, { canonicalPostId: canonical, mergedAt: new Date() })
    await seedPost(seeded, { deletedAt: new Date() })

    const anonymous = await getPublicRoadmapPosts(
      roadmapId,
      { statusId: seeded.statusA },
      ANONYMOUS_ACTOR
    )
    expect(anonymous.items.map((post) => post.id)).toEqual(
      expect.arrayContaining([visible, canonical])
    )
    expect(anonymous.items).toHaveLength(2)

    const team = await getPublicRoadmapPosts(
      roadmapId,
      { statusId: seeded.statusA },
      actor({ role: 'member', principalId: seeded.authorA })
    )
    expect(team.items.some((post) => post.board.id === seeded.boardB)).toBe(true)
    expect(team.items.some((post) => post.board.id === seeded.deletedBoard)).toBe(false)

    const admin = await getRoadmapPosts(roadmapId, { statusId: seeded.statusA })
    expect(admin.items.some((post) => post.board.id === seeded.boardB)).toBe(true)
    expect(admin.items.some((post) => post.board.id === seeded.deletedBoard)).toBe(false)
    expect(admin.items.some((post) => post.id === canonical)).toBe(true)
    expect(admin.items.some((post) => post.id === merged)).toBe(false)
  })

  it('enforces public, team, and matching-segment roadmap visibility', async () => {
    const seeded = await seedBase()
    const publicRoadmap = await seedRoadmap(seeded, { visibility: 'public' })
    const teamRoadmap = await seedRoadmap(seeded, { visibility: 'team' })
    const segmentRoadmap = await seedRoadmap(seeded, {
      visibility: 'segment',
      visibleSegmentIds: [seeded.segmentA],
    })
    await seedPost(seeded)

    await expect(
      getPublicRoadmapPosts(publicRoadmap, { statusId: seeded.statusA }, ANONYMOUS_ACTOR)
    ).resolves.toMatchObject({ total: 1 })
    await expect(
      getPublicRoadmapPosts(teamRoadmap, { statusId: seeded.statusA }, ANONYMOUS_ACTOR)
    ).rejects.toMatchObject({ code: 'ROADMAP_NOT_FOUND' })
    await expect(
      getPublicRoadmapPosts(
        segmentRoadmap,
        { statusId: seeded.statusA },
        actor({ principalId: seeded.authorA, segmentIds: new Set([seeded.segmentA]) })
      )
    ).resolves.toMatchObject({ total: 1 })
    await expect(
      getPublicRoadmapPosts(
        segmentRoadmap,
        { statusId: seeded.statusA },
        actor({ principalId: seeded.authorB })
      )
    ).rejects.toMatchObject({ code: 'ROADMAP_NOT_FOUND' })
    await expect(
      getPublicRoadmapPosts(
        teamRoadmap,
        { statusId: seeded.statusA },
        actor({ role: 'member', principalId: seeded.authorA })
      )
    ).resolves.toMatchObject({ total: 1 })
  })
})
