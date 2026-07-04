/**
 * Office hours (§4.6): the pure DST-safe resolver (no DB) + the one-schedule
 * service (real DB, rolled back). The resolver is the piece SLA + workflows will
 * lean on, so its timezone/DST behavior is pinned hard.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { officeHoursSchedules } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  isWithinOfficeHours,
  getDefaultSchedule,
  upsertDefaultSchedule,
  isWorkspaceWithinOfficeHours,
} from '../office-hours.service'

// ---------------------------------------------------------------------------
// Pure resolver (no DB)
// ---------------------------------------------------------------------------

describe('isWithinOfficeHours', () => {
  it('treats an empty or all-malformed schedule as 24/7', () => {
    const at = new Date('2026-01-05T03:00:00Z')
    expect(isWithinOfficeHours({ timezone: 'UTC', intervals: [] }, at)).toBe(true)
    expect(
      isWithinOfficeHours(
        { timezone: 'UTC', intervals: [{ day: 9, start: 'bad', end: 'worse' }] },
        at
      )
    ).toBe(true)
  })

  it('matches a weekday window in the schedule timezone', () => {
    // 2026-01-05 is a Monday. Mon 09:00-17:00 America/New_York (EST = UTC-5).
    const schedule = {
      timezone: 'America/New_York',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    }
    // 15:00 UTC = 10:00 EST Monday -> inside.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T15:00:00Z'))).toBe(true)
    // 23:00 UTC = 18:00 EST Monday -> after close.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T23:00:00Z'))).toBe(false)
    // 13:00 UTC = 08:00 EST Monday -> before open.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T13:00:00Z'))).toBe(false)
  })

  it('is DST-safe: the same local rule holds across the offset change', () => {
    const schedule = {
      timezone: 'America/New_York',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    }
    // Summer 2026-07-06 is a Monday; EDT = UTC-4, so 10:00 local = 14:00 UTC.
    expect(isWithinOfficeHours(schedule, new Date('2026-07-06T14:00:00Z'))).toBe(true)
    // Winter same local 10:00 = 15:00 UTC (EST). Both resolve inside despite the
    // different UTC instant — the whole point of tz-aware resolution.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T15:00:00Z'))).toBe(true)
  })

  it('does not bleed a window into the wrong weekday', () => {
    const schedule = { timezone: 'UTC', intervals: [{ day: 1, start: '09:00', end: '17:00' }] }
    // 2026-01-06 is a Tuesday 10:00 UTC -> the Monday window must not match.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-06T10:00:00Z'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The one workspace schedule (real DB)
// ---------------------------------------------------------------------------

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: officeHoursSchedules.id }).from(officeHoursSchedules).limit(0)
  },
})

describe.skipIf(!fixture.available)('office-hours.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('upserts the single default schedule (create then update, never duplicate)', async () => {
    const created = await upsertDefaultSchedule({
      timezone: 'Europe/London',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    })
    expect(created.isDefault).toBe(true)
    expect(created.timezone).toBe('Europe/London')

    const updated = await upsertDefaultSchedule({
      timezone: 'Europe/Berlin',
      intervals: [{ day: 2, start: '08:00', end: '16:00' }],
    })
    expect(updated.id).toBe(created.id) // same row, not a duplicate
    expect(updated.timezone).toBe('Europe/Berlin')

    const resolved = await getDefaultSchedule()
    expect(resolved?.id).toBe(created.id)
  })

  it('resolves 24/7 when unconfigured, and the schedule once set', async () => {
    // No schedule yet -> always open.
    expect(await isWorkspaceWithinOfficeHours(new Date('2026-01-05T03:00:00Z'))).toBe(true)

    await upsertDefaultSchedule({
      timezone: 'UTC',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    })
    // Monday 10:00 UTC inside; Monday 20:00 UTC outside.
    expect(await isWorkspaceWithinOfficeHours(new Date('2026-01-05T10:00:00Z'))).toBe(true)
    expect(await isWorkspaceWithinOfficeHours(new Date('2026-01-05T20:00:00Z'))).toBe(false)
  })
})
