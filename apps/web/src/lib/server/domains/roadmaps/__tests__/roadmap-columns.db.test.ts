/**
 * Roadmap column writes, against the real schema.
 *
 * - A column naming a status that does not exist (or was deleted) is a
 *   not-found for that status, not a foreign-key failure (a 500).
 * - A column edit or removal through /roadmaps/:roadmapId/columns/:columnId
 *   touches only that roadmap's columns: another roadmap's column is a 404
 *   and stays as it was.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateId, type PostStatusId, type RoadmapColumnId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn().mockResolvedValue({ principalId: 'principal_test', role: 'admin' }),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, postStatuses, roadmapColumns, roadmaps } from '@/lib/server/db'
import { createRoadmapColumn } from '../roadmap.service'
import { Route as ColumnRoute } from '@/routes/api/v1/roadmaps/$roadmapId.columns.$columnId'

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: roadmaps.id, type: roadmaps.type }).from(roadmaps).limit(0)
    await db.select({ id: roadmapColumns.id }).from(roadmapColumns).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seedRoadmap() {
  const [roadmap] = await testDb
    .insert(roadmaps)
    .values({ slug: `r-${suffix()}`, name: 'Plan', type: 'column', baseFilter: {} })
    .returning()
  return roadmap
}

async function seedStatus(deletedAt: Date | null = null) {
  const [status] = await testDb
    .insert(postStatuses)
    .values({ name: 'Planned', slug: `s_${suffix()}`, color: '#123456', deletedAt })
    .returning()
  return status
}

describe.skipIf(!fixture.available)('roadmap columns', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('createRoadmapColumn', () => {
    it('refuses an unknown status as not found', async () => {
      const roadmap = await seedRoadmap()

      await expect(
        createRoadmapColumn({
          roadmapId: roadmap.id,
          statusId: generateId('post_status') as PostStatusId,
          name: 'X',
          color: '#000000',
        })
      ).rejects.toMatchObject({ code: 'STATUS_NOT_FOUND' })
    })

    it('refuses a deleted status as not found', async () => {
      const roadmap = await seedRoadmap()
      const status = await seedStatus(new Date())

      await expect(
        createRoadmapColumn({
          roadmapId: roadmap.id,
          statusId: status.id,
          name: 'X',
          color: '#000000',
        })
      ).rejects.toMatchObject({ code: 'STATUS_NOT_FOUND' })
    })

    it('adds a column for a live status', async () => {
      const roadmap = await seedRoadmap()
      const status = await seedStatus()

      const column = await createRoadmapColumn({
        roadmapId: roadmap.id,
        statusId: status.id,
        name: 'Next',
        color: '#000000',
      })

      expect(column).toMatchObject({ roadmapId: roadmap.id, statusId: status.id, name: 'Next' })
    })
  })

  describe("another roadmap's column through a roadmap's URL", () => {
    async function seedTwo() {
      const a = await seedRoadmap()
      const b = await seedRoadmap()
      const status = await seedStatus()
      const [column] = await testDb
        .insert(roadmapColumns)
        .values({ roadmapId: b.id, statusId: status.id, name: 'Mine', color: '#111111' })
        .returning()
      return { a, b, column }
    }

    function columnRoute(method: 'PATCH' | 'DELETE', roadmapId: string, columnId: string) {
      const handler = (
        ColumnRoute.options as unknown as { server: { handlers: Record<string, Handler> } }
      ).server.handlers[method]
      return handler({
        request: new Request(`http://test/api/v1/roadmaps/${roadmapId}/columns/${columnId}`, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(method === 'PATCH' ? { body: JSON.stringify({ name: 'moved' }) } : {}),
        }),
        params: { roadmapId, columnId },
      })
    }

    function columnRows(id: RoadmapColumnId) {
      return testDb.select().from(roadmapColumns).where(eq(roadmapColumns.id, id))
    }

    it('answers 404 to an edit and leaves the column as it was', async () => {
      const { a, b, column } = await seedTwo()

      expect((await columnRoute('PATCH', a.id, column.id)).status).toBe(404)
      expect(await columnRows(column.id)).toEqual([
        expect.objectContaining({ roadmapId: b.id, name: 'Mine' }),
      ])

      expect((await columnRoute('PATCH', b.id, column.id)).status).toBe(200)
      expect(await columnRows(column.id)).toEqual([expect.objectContaining({ name: 'moved' })])
    })

    it('answers 404 to a removal and keeps the column', async () => {
      const { a, b, column } = await seedTwo()

      expect((await columnRoute('DELETE', a.id, column.id)).status).toBe(404)
      expect(await columnRows(column.id)).toHaveLength(1)

      expect((await columnRoute('DELETE', b.id, column.id)).status).toBe(204)
      expect(await columnRows(column.id)).toHaveLength(0)
    })
  })
})
