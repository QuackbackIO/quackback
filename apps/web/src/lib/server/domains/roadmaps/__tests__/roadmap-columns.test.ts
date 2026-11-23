/**
 * RMP-A-12: the single-column paths (createRoadmapColumn, updateRoadmapColumn)
 * should refuse what the bulk columns path refuses.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostStatusId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, postStatuses, roadmapColumns, roadmaps } from '@/lib/server/db'
import { createRoadmap, createRoadmapColumn, updateRoadmapColumn } from '../roadmap.service'

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
    .values({ name, slug: `rmp-columns-${suffix()}`, color: '#123456' })
    .returning()
  return status.id
}

async function seedColumnRoadmap() {
  const planned = await seedStatus('Planned')
  const building = await seedStatus('Building')
  const roadmap = await createRoadmap({
    name: 'Columns',
    slug: `rmp-a-12-${suffix()}`,
    columns: [{ statusId: planned, name: 'Planned', color: '#111111', position: 0 }],
  })
  return { roadmap, planned, building }
}

describe.skipIf(!fixture.available)('roadmap single-column paths (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('RMP-A-12 adds a column for a new status at the end', async () => {
    const { roadmap, building } = await seedColumnRoadmap()

    const column = await createRoadmapColumn({
      roadmapId: roadmap.id,
      statusId: building,
      name: '  Building  ',
      color: '#222222',
    })

    expect(column).toMatchObject({ statusId: building, name: 'Building', position: 1 })
  })

  it('RMP-A-12 date roadmaps refuse status columns', async () => {
    const status = await seedStatus('Planned')
    const roadmap = await createRoadmap({
      name: 'Timeline',
      slug: `rmp-a-12-${suffix()}`,
      type: 'date',
    })

    await expect(
      createRoadmapColumn({ roadmapId: roadmap.id, statusId: status, name: 'X', color: '#111' })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Date roadmaps cannot have status columns',
    })
  })

  it('RMP-A-12 refuses a second column for a status the roadmap already has', async () => {
    const { roadmap, planned } = await seedColumnRoadmap()

    await expect(
      createRoadmapColumn({
        roadmapId: roadmap.id,
        statusId: planned,
        name: 'Planned again',
        color: '#333333',
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Each status can appear only once in a roadmap',
    })
  })

  it('RMP-A-12 refuses renaming a column to whitespace', async () => {
    const { roadmap } = await seedColumnRoadmap()
    const columnId = roadmap.columns[0].id

    await expect(updateRoadmapColumn(columnId, { name: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    const [row] = await testDb
      .select({ name: roadmapColumns.name })
      .from(roadmapColumns)
      .where(eq(roadmapColumns.id, columnId))
    expect(row.name).toBe('Planned')
  })
})
