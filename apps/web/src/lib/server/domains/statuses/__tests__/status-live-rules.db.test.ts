/**
 * Status rules that only real SQL shows:
 * - FBA-T-21: a deleted status frees its slug for a new one.
 * - FBA-T-25: the default status cannot be unset, so the workspace always
 *   keeps exactly one default (it moves by marking another status default).
 *
 * Real Postgres in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, isNull, postStatuses } from '@/lib/server/db'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createStatus, deleteStatus, updateStatus } from '../status.service'

const fixture = await createDbTestFixture()
const slugOf = () => `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

describe.skipIf(!fixture.available)('status rules (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('FBA-T-21 a status can be created again with the slug of a deleted one', async () => {
    const slug = slugOf()
    const first = await createStatus({ name: 'Reborn', slug, color: '#3b82f6', category: 'active' })
    await deleteStatus(first.id)

    const again = await createStatus({ name: 'Reborn', slug, color: '#3b82f6', category: 'active' })
    expect(again.id).not.toBe(first.id)
    expect(again.slug).toBe(slug)
  })

  it('FBA-T-21 still refuses the slug of a live status', async () => {
    const slug = slugOf()
    await createStatus({ name: 'Taken', slug, color: '#3b82f6', category: 'active' })
    await expect(
      createStatus({ name: 'Taken again', slug, color: '#3b82f6', category: 'active' })
    ).rejects.toMatchObject({ code: 'DUPLICATE_SLUG' })
  })

  it('FBA-T-25 refuses to unset the only default status', async () => {
    await testDb.update(postStatuses).set({ isDefault: false })
    const status = await createStatus({
      name: 'The default',
      slug: slugOf(),
      color: '#3b82f6',
      category: 'active',
    })
    await testDb.update(postStatuses).set({ isDefault: true }).where(eq(postStatuses.id, status.id))

    await expect(updateStatus(status.id, { isDefault: false })).rejects.toMatchObject({
      code: 'CANNOT_UNSET_DEFAULT',
    })
    const defaults = await testDb
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(and(eq(postStatuses.isDefault, true), isNull(postStatuses.deletedAt)))
    expect(defaults.map((d) => d.id)).toEqual([status.id])
  })

  it('FBA-T-25 isDefault false on a status that is not the default changes nothing', async () => {
    const status = await createStatus({
      name: 'Not default',
      slug: slugOf(),
      color: '#3b82f6',
      category: 'active',
    })
    const updated = await updateStatus(status.id, { isDefault: false, name: 'Renamed' })
    expect(updated.isDefault).toBe(false)
    expect(updated.name).toBe('Renamed')
  })
})
