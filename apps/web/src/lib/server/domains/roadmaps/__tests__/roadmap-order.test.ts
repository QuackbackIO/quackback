/**
 * RMP-A-17: roadmaps list in creation order (each new one appends at the next
 * position) and reorderRoadmaps rewrites every position in one UPDATE.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'drizzle-orm'
import type { RoadmapId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { inArray, roadmaps } from '@/lib/server/db'
import { createRoadmap, listRoadmaps, reorderRoadmaps } from '../roadmap.service'

const statements: string[] = []
const recorder: Logger = { logQuery: (query) => statements.push(query) }

const fixture = await createDbTestFixture({
  logger: recorder,
  probe: async (db) => {
    await db.select({ id: roadmaps.id, position: roadmaps.position }).from(roadmaps).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function createThree(): Promise<RoadmapId[]> {
  const ids: RoadmapId[] = []
  for (const name of ['First', 'Second', 'Third']) {
    const created = await createRoadmap({ name, slug: `rmp-a-17-${suffix()}`, columns: [] })
    ids.push(created.id)
  }
  return ids
}

async function positionsOf(ids: RoadmapId[]): Promise<Map<RoadmapId, number>> {
  const rows = await testDb
    .select({ id: roadmaps.id, position: roadmaps.position })
    .from(roadmaps)
    .where(inArray(roadmaps.id, ids))
  return new Map(rows.map((row) => [row.id, row.position]))
}

async function listedOrder(ids: RoadmapId[]): Promise<RoadmapId[]> {
  const wanted = new Set(ids)
  return (await listRoadmaps()).map((r) => r.id).filter((id) => wanted.has(id))
}

describe.skipIf(!fixture.available)('roadmap order (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('RMP-A-17 appends each new roadmap at the next position and lists in that order', async () => {
    const [a, b, c] = await createThree()
    const positions = await positionsOf([a, b, c])

    expect(positions.get(b)).toBe(positions.get(a)! + 1)
    expect(positions.get(c)).toBe(positions.get(b)! + 1)
    expect(await listedOrder([a, b, c])).toEqual([a, b, c])
  })

  it('RMP-A-17 reorderRoadmaps rewrites positions in a single UPDATE', async () => {
    const [a, b, c] = await createThree()

    statements.length = 0
    await reorderRoadmaps([c, a, b])
    const updates = statements.filter((q) => /^update "roadmaps"/i.test(q.trim()))

    expect(updates).toHaveLength(1)
    const positions = await positionsOf([a, b, c])
    expect([positions.get(c), positions.get(a), positions.get(b)]).toEqual([0, 1, 2])
    expect(await listedOrder([a, b, c])).toEqual([c, a, b])
  })

  it('RMP-A-17 reorderRoadmaps with no ids changes nothing', async () => {
    const ids = await createThree()
    const before = await positionsOf(ids)

    statements.length = 0
    await reorderRoadmaps([])

    expect(statements.filter((q) => /^update/i.test(q.trim()))).toEqual([])
    expect(await positionsOf(ids)).toEqual(before)
  })
})
