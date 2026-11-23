/**
 * Boards, statuses and tags behind the REST taxonomy endpoints, against the
 * real schema.
 *
 * - A status PATCH carrying only fields the API ignores must answer the row
 *   unchanged rather than running an UPDATE with an empty SET (a 500).
 * - A soft-deleted board, status or tag is gone: reading or editing it by id
 *   is a not-found, the same as a delete of it already is.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postStatuses, postTags } from '@/lib/server/db'
import { getBoardById, updateBoard } from '@/lib/server/domains/boards/board.service'
import { getStatusById, updateStatus } from '@/lib/server/domains/statuses/status.service'
import { getTagById, updatePostTag } from '@/lib/server/domains/post-tags/post-tag.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: boards.id, deletedAt: boards.deletedAt }).from(boards).limit(0)
    await db
      .select({ id: postStatuses.id, deletedAt: postStatuses.deletedAt })
      .from(postStatuses)
      .limit(0)
    await db.select({ id: postTags.id, deletedAt: postTags.deletedAt }).from(postTags).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seedStatus(overrides: Partial<typeof postStatuses.$inferInsert> = {}) {
  const [status] = await testDb
    .insert(postStatuses)
    .values({ name: 'Planned', slug: `s_${suffix()}`, color: '#123456', ...overrides })
    .returning()
  return status
}

describe.skipIf(!fixture.available)('REST taxonomy services', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('updateStatus with nothing to change', () => {
    it('answers the row unchanged', async () => {
      const status = await seedStatus()

      const updated = await updateStatus(status.id, {})

      expect(updated).toMatchObject({ id: status.id, name: 'Planned', color: '#123456' })
    })

    it('answers the row as made default when isDefault is the only field', async () => {
      const status = await seedStatus()

      const updated = await updateStatus(status.id, { isDefault: true })

      expect(updated).toMatchObject({ id: status.id, isDefault: true })
    })
  })

  describe('soft-deleted rows', () => {
    it('a deleted status is not found by id or for an update', async () => {
      const status = await seedStatus({ deletedAt: new Date() })

      await expect(getStatusById(status.id)).rejects.toMatchObject({ code: 'STATUS_NOT_FOUND' })
      await expect(updateStatus(status.id, { name: 'Edited' })).rejects.toMatchObject({
        code: 'STATUS_NOT_FOUND',
      })
    })

    it('a deleted board is not found by id or for an update', async () => {
      const [board] = await testDb
        .insert(boards)
        .values({ slug: `b-${suffix()}`, name: 'Gone', deletedAt: new Date() })
        .returning()

      await expect(getBoardById(board.id)).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' })
      await expect(updateBoard(board.id, { name: 'Edited' })).rejects.toMatchObject({
        code: 'BOARD_NOT_FOUND',
      })
    })

    it('a deleted tag is not found by id or for an update', async () => {
      const [tag] = await testDb
        .insert(postTags)
        .values({ name: `Gone ${suffix()}`, deletedAt: new Date() })
        .returning()

      await expect(getTagById(tag.id)).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })
      await expect(updatePostTag(tag.id, { name: 'Edited' })).rejects.toMatchObject({
        code: 'TAG_NOT_FOUND',
      })
    })
  })
})
