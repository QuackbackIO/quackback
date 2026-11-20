/**
 * RMP-A-05: deleting a roadmap should free its slug for a new roadmap.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { roadmaps } from '@/lib/server/db'
import { createRoadmap, deleteRoadmap, getRoadmapBySlug } from '../roadmap.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roadmaps.id, deletedAt: roadmaps.deletedAt }).from(roadmaps).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

describe.skipIf(!fixture.available)('roadmap slug reuse (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('RMP-A-05 a live roadmap still blocks its slug', async () => {
    const slug = `q4-${suffix()}`
    await createRoadmap({ name: 'Q4', slug, columns: [] })

    await expect(createRoadmap({ name: 'Q4 again', slug, columns: [] })).rejects.toMatchObject({
      code: 'DUPLICATE_SLUG',
    })
  })

  // Root cause: createRoadmap's slug check queries roadmaps by slug without
  // isNull(deletedAt) (apps/web/src/lib/server/domains/roadmaps/roadmap.service.ts:143),
  // and roadmaps.slug is a plain unique constraint (packages/db/src/schema/boards.ts:55),
  // so a soft-deleted roadmap keeps its slug forever. See apps/web/e2e/QUARANTINE.md.
  it.fails(
    'RMP-A-05 a deleted roadmap frees its slug for a new one (quarantined: soft-deleted roadmap still reserves its slug)',
    async () => {
      const slug = `q4-${suffix()}`
      const first = await createRoadmap({ name: 'Q4', slug, columns: [] })
      await deleteRoadmap(first.id)

      const second = await createRoadmap({ name: 'Q4', slug, columns: [] })

      expect(second.id).not.toBe(first.id)
      expect((await getRoadmapBySlug(slug)).id).toBe(second.id)
    }
  )
})
