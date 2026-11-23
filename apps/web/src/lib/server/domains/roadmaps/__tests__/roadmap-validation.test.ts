/**
 * Real-DB coverage for the roadmap create/update refusals (RMP-A-06) and the
 * type / date source / frequency rules (RMP-A-08). Every refusal must carry
 * its exact message and leave the roadmaps table untouched.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostStatusId, RoadmapId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, postStatuses, roadmapColumns, roadmaps } from '@/lib/server/db'
import type { RoadmapBaseFilter } from '@/lib/shared/roadmap-config'
import type { CreateRoadmapInput } from '../roadmap.types'
import { createRoadmap, getRoadmap, updateRoadmap } from '../roadmap.service'

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
    .values({ name, slug: `rmp-validation-${suffix()}`, color: '#123456' })
    .returning()
  return status.id
}

async function roadmapRowsWithSlug(slug: string) {
  return testDb.select({ id: roadmaps.id }).from(roadmaps).where(eq(roadmaps.slug, slug))
}

describe.skipIf(!fixture.available)('roadmap validation (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('RMP-A-06 create refusals', () => {
    it.each<[string, (slug: string, status: PostStatusId) => CreateRoadmapInput, string]>([
      ['an empty name', (slug) => ({ name: '   ', slug }), 'Name is required'],
      [
        'a name over 100 characters',
        (slug) => ({ name: 'x'.repeat(101), slug }),
        'Name must be 100 characters or less',
      ],
      [
        'a slug with capitals and spaces',
        () => ({ name: 'Plan', slug: 'Q4 Plan' }),
        'Slug must contain only lowercase letters, numbers, and hyphens',
      ],
      [
        'an unknown base filter key',
        (slug) => ({
          name: 'Plan',
          slug,
          baseFilter: { unknownKey: ['x'] } as unknown as RoadmapBaseFilter,
        }),
        'Invalid roadmap base filter',
      ],
      [
        'segment visibility without segments',
        (slug) => ({ name: 'Plan', slug, visibility: 'segment', visibleSegmentIds: [] }),
        'Segment-visible roadmaps require at least one segment',
      ],
      [
        'a status used by two columns',
        (slug, status) => ({
          name: 'Plan',
          slug,
          columns: [
            { statusId: status, name: 'One', color: '#111111', position: 0 },
            { statusId: status, name: 'Two', color: '#222222', position: 1 },
          ],
        }),
        'Each status can appear only once in a roadmap',
      ],
      [
        'a column with an empty name',
        (slug, status) => ({
          name: 'Plan',
          slug,
          columns: [{ statusId: status, name: '  ', color: '#111111', position: 0 }],
        }),
        'Column name is required',
      ],
      [
        'a column with an empty colour',
        (slug, status) => ({
          name: 'Plan',
          slug,
          columns: [{ statusId: status, name: 'One', color: ' ', position: 0 }],
        }),
        'Column color is required',
      ],
    ])(
      'RMP-A-06 refuses %s with its message and writes nothing',
      async (_label, build, message) => {
        const status = await seedStatus('Planned')
        const slug = `rmp-a-06-${suffix()}`
        const input = build(slug, status)

        await expect(createRoadmap(input)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
          message,
        })
        expect(await roadmapRowsWithSlug(input.slug)).toEqual([])
      }
    )
  })

  describe('RMP-A-06 update refusals', () => {
    it('RMP-A-06 refuses a blank or over-long name and leaves the roadmap unchanged', async () => {
      const created = await createRoadmap({
        name: 'Original',
        slug: `rmp-a-06-${suffix()}`,
        columns: [],
      })

      await expect(updateRoadmap(created.id, { name: '   ' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Name cannot be empty',
      })
      await expect(updateRoadmap(created.id, { name: 'y'.repeat(101) })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Name must be 100 characters or less',
      })
      await expect(
        updateRoadmap(created.id, { visibility: 'segment', visibleSegmentIds: [] })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Segment-visible roadmaps require at least one segment',
      })

      const after = await getRoadmap(created.id)
      expect(after.name).toBe('Original')
      expect(after.visibility).toBe('public')
    })
  })

  describe('RMP-A-08 type, date source and frequency', () => {
    it.each<[string, Partial<CreateRoadmapInput>, string]>([
      [
        'a date roadmap without a frequency',
        { type: 'date', frequency: null },
        'Date roadmaps require ETA as the date source and a frequency',
      ],
      [
        'a date roadmap without a date source',
        { type: 'date', dateSource: null },
        'Date roadmaps require ETA as the date source and a frequency',
      ],
      [
        'a column roadmap with a frequency',
        { type: 'column', frequency: 'monthly' },
        'Column roadmaps cannot have a date source or frequency',
      ],
      [
        'a column roadmap with a date source',
        { type: 'column', dateSource: 'eta' },
        'Column roadmaps cannot have a date source or frequency',
      ],
    ])('RMP-A-08 refuses %s', async (_label, config, message) => {
      const slug = `rmp-a-08-${suffix()}`
      await expect(createRoadmap({ name: 'Plan', slug, ...config })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message,
      })
      expect(await roadmapRowsWithSlug(slug)).toEqual([])
    })

    it('RMP-A-08 defaults a new date roadmap to ETA, monthly and no columns', async () => {
      await seedStatus('Planned')
      const created = await createRoadmap({
        name: 'Timeline',
        slug: `rmp-a-08-${suffix()}`,
        type: 'date',
      })
      expect(created).toMatchObject({ type: 'date', dateSource: 'eta', frequency: 'monthly' })
      expect(created.columns).toEqual([])
    })

    it('RMP-A-08 switching column to date sets the derived fields and drops the columns; back to column clears them', async () => {
      const status = await seedStatus('Planned')
      const created = await createRoadmap({
        name: 'Switcher',
        slug: `rmp-a-08-${suffix()}`,
        columns: [{ statusId: status, name: 'Planned', color: '#111111', position: 0 }],
      })
      expect(created.columns).toHaveLength(1)

      const asDate = await updateRoadmap(created.id, { type: 'date' })
      expect(asDate).toMatchObject({ type: 'date', dateSource: 'eta', frequency: 'monthly' })
      expect(asDate.columns).toEqual([])

      const quarterly = await updateRoadmap(created.id, { frequency: 'quarterly' })
      expect(quarterly.frequency).toBe('quarterly')

      const asColumn = await updateRoadmap(created.id, { type: 'column' })
      expect(asColumn).toMatchObject({ type: 'column', dateSource: null, frequency: null })

      const [row] = await testDb
        .select({ dateSource: roadmaps.dateSource, frequency: roadmaps.frequency })
        .from(roadmaps)
        .where(eq(roadmaps.id, created.id as RoadmapId))
      expect(row).toEqual({ dateSource: null, frequency: null })
    })
  })
})
