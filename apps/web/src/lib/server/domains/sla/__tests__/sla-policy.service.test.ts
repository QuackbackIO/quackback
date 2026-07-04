/**
 * Real-DB coverage for SLA policy CRUD (support platform §4.6): create/read/list,
 * a partial update, the office-hours link, and the soft-delete filter. Runs inside
 * the db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { OfficeHoursId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { slaPolicies, officeHoursSchedules } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  createSlaPolicy,
  listSlaPolicies,
  getSlaPolicy,
  updateSlaPolicy,
  softDeleteSlaPolicy,
} from '../sla-policy.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: slaPolicies.id }).from(slaPolicies).limit(0)
  },
})

async function seedSchedule(): Promise<OfficeHoursId> {
  const [row] = await testDb
    .insert(officeHoursSchedules)
    .values({ name: 'Biz hours', timezone: 'UTC', intervals: [] })
    .returning()
  return row.id
}

describe.skipIf(!fixture.available)('sla-policy.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates, reads, and lists policies (defaults applied)', async () => {
    const created = await createSlaPolicy({ name: 'Priority', firstResponseTargetSecs: 900 })
    expect(created.name).toBe('Priority')
    expect(created.firstResponseTargetSecs).toBe(900)
    expect(created.pauseOnSnooze).toBe(true) // default
    expect(created.timeToCloseTargetSecs).toBeNull()

    expect((await getSlaPolicy(created.id))?.id).toBe(created.id)
    expect(await listSlaPolicies()).toHaveLength(1)
  })

  it('links a policy to an office-hours schedule and patches a subset', async () => {
    const scheduleId = await seedSchedule()
    const created = await createSlaPolicy({
      name: 'Standard',
      officeHoursScheduleId: scheduleId,
      pauseOnSnooze: false,
    })
    expect(created.officeHoursScheduleId).toBe(scheduleId)
    expect(created.pauseOnSnooze).toBe(false)

    const updated = await updateSlaPolicy(created.id, { timeToCloseTargetSecs: 86400 })
    expect(updated.timeToCloseTargetSecs).toBe(86400)
    expect(updated.name).toBe('Standard') // untouched fields preserved
    expect(updated.officeHoursScheduleId).toBe(scheduleId)
  })

  it('soft-delete hides a policy from get + list', async () => {
    const created = await createSlaPolicy({ name: 'Temp' })
    await softDeleteSlaPolicy(created.id)
    expect(await getSlaPolicy(created.id)).toBeNull()
    expect(await listSlaPolicies()).toHaveLength(0)
  })
})
