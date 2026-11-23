/**
 * RMP-E-16: deleting a status takes its column off every roadmap that used it,
 * so no roadmap keeps a permanently empty column the builder cannot show.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostStatusId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, postStatuses, roadmapColumns, roadmaps } from '@/lib/server/db'
import { createRoadmap, getRoadmap } from '../../roadmaps/roadmap.service'
import { deleteStatus } from '../status.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roadmaps.id, type: roadmaps.type }).from(roadmaps).limit(0)
    await db.select({ id: roadmapColumns.id }).from(roadmapColumns).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedStatus(name: string): Promise<PostStatusId> {
  const [status] = await testDb
    .insert(postStatuses)
    .values({ name, slug: `rmp-e-16-${suffix()}`, color: '#123456' })
    .returning()
  return status.id
}

describe.skipIf(!fixture.available)('deleting a status (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('RMP-E-16 removes the status column from every roadmap that used it', async () => {
    const planned = await seedStatus('Planned')
    const retired = await seedStatus('Retired')
    const columns = [
      { statusId: planned, name: 'Planned', color: '#111111', position: 0 },
      { statusId: retired, name: 'Retired', color: '#222222', position: 1 },
    ]
    const first = await createRoadmap({ name: 'One', slug: `rmp-e-16-${suffix()}`, columns })
    const second = await createRoadmap({ name: 'Two', slug: `rmp-e-16-${suffix()}`, columns })

    await deleteStatus(retired)

    for (const roadmap of [first, second]) {
      const { columns: left } = await getRoadmap(roadmap.id)
      expect(left.map((column) => column.statusId)).toEqual([planned])
    }
    const orphans = await testDb
      .select({ id: roadmapColumns.id })
      .from(roadmapColumns)
      .where(eq(roadmapColumns.statusId, retired))
    expect(orphans).toEqual([])
  })
})
