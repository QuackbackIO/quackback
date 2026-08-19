import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type RoadmapId, type SegmentId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { and, eq, roadmaps } from '@/lib/server/db'
import { canViewRoadmap, roadmapViewFilter } from '../roadmaps'
import { ANONYMOUS_ACTOR, type Actor } from '../types'

const segmentA = createId('segment') as SegmentId
const segmentB = createId('segment') as SegmentId

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roadmaps.id, visibility: roadmaps.visibility }).from(roadmaps).limit(0)
  },
})

function actor(overrides: Partial<Actor>): Actor {
  return {
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
    ...overrides,
  }
}

const actors: Record<string, Actor> = {
  anonymous: ANONYMOUS_ACTOR,
  user: actor({}),
  matchingUser: actor({ segmentIds: new Set([segmentA]) }),
  nonMatchingUser: actor({ segmentIds: new Set([segmentB]) }),
  matchingService: actor({ principalType: 'service', segmentIds: new Set([segmentA]) }),
  member: actor({ role: 'member' }),
}

const shapes = [
  { visibility: 'public' as const, visibleSegmentIds: null },
  { visibility: 'team' as const, visibleSegmentIds: null },
  { visibility: 'segment' as const, visibleSegmentIds: [segmentA] },
  { visibility: 'segment' as const, visibleSegmentIds: [] },
]

describe.skipIf(!fixture.available)('roadmap visibility SQL and memory parity', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  for (const [actorName, viewer] of Object.entries(actors)) {
    for (const shape of shapes) {
      it(`${actorName} matches ${shape.visibility}:${shape.visibleSegmentIds?.length ?? 0}`, async () => {
        const [roadmap] = await testDb
          .insert(roadmaps)
          .values({
            slug: `policy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: 'Policy roadmap',
            visibility: shape.visibility,
            visibleSegmentIds: shape.visibleSegmentIds,
          })
          .returning()

        const rows = await testDb
          .select({ id: roadmaps.id })
          .from(roadmaps)
          .where(and(eq(roadmaps.id, roadmap.id as RoadmapId), roadmapViewFilter(viewer)))

        expect(rows.length === 1).toBe(canViewRoadmap(viewer, roadmap).allowed)
      })
    }
  }

  it('excludes deleted roadmaps for team actors in both paths', async () => {
    const [roadmap] = await testDb
      .insert(roadmaps)
      .values({
        slug: `policy-deleted-${Date.now()}`,
        name: 'Deleted roadmap',
        visibility: 'team',
        deletedAt: new Date(),
      })
      .returning()
    const viewer = actors.member
    const rows = await testDb
      .select({ id: roadmaps.id })
      .from(roadmaps)
      .where(and(eq(roadmaps.id, roadmap.id), roadmapViewFilter(viewer)))
    expect(rows).toEqual([])
    expect(canViewRoadmap(viewer, roadmap).allowed).toBe(false)
  })
})
