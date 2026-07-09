/**
 * Office-hours clock math (§4.6): the pure DST-safe resolver and the
 * settings-blob → engine-shape adapter (both DB-free). The resolver is the
 * piece SLA + workflows lean on, so its timezone/DST behavior is pinned hard.
 */
import { describe, it, expect } from 'vitest'

import {
  isWithinOfficeHours,
  addOfficeHoursSeconds,
  engineScheduleFromWorkspace,
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

describe('addOfficeHoursSeconds', () => {
  // Mon-Fri 09:00-17:00 (8h/day), UTC. 2026-01-05 is a Monday.
  const weekdays = {
    timezone: 'UTC',
    intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
  }
  const iso = (d: Date) => d.toISOString()

  it('is plain wall-clock for a 24/7 (empty) schedule, and a no-op for 0s', () => {
    const start = new Date('2026-01-05T10:00:00Z')
    expect(iso(addOfficeHoursSeconds({ timezone: 'UTC', intervals: [] }, start, 3600))).toBe(
      '2026-01-05T11:00:00.000Z'
    )
    expect(iso(addOfficeHoursSeconds(weekdays, start, 0))).toBe('2026-01-05T10:00:00.000Z')
  })

  it('consumes within an open window', () => {
    // Mon 10:00 + 1h -> Mon 11:00.
    expect(iso(addOfficeHoursSeconds(weekdays, new Date('2026-01-05T10:00:00Z'), 3600))).toBe(
      '2026-01-05T11:00:00.000Z'
    )
  })

  it('waits for the window to open when the clock starts before hours', () => {
    // Mon 07:00 + 1h of open time -> opens 09:00, +1h -> Mon 10:00.
    expect(iso(addOfficeHoursSeconds(weekdays, new Date('2026-01-05T07:00:00Z'), 3600))).toBe(
      '2026-01-05T10:00:00.000Z'
    )
  })

  it('spills past close into the next open day', () => {
    // Mon 10:00 + 8h: 7h left today (10->17), 1h Tue -> Tue 10:00.
    expect(iso(addOfficeHoursSeconds(weekdays, new Date('2026-01-05T10:00:00Z'), 8 * 3600))).toBe(
      '2026-01-06T10:00:00.000Z'
    )
  })

  it('skips the closed weekend', () => {
    // Fri 16:00 + 2h: 1h Fri (16->17), Sat/Sun closed, 1h Mon from 09:00 -> Mon 10:00.
    expect(iso(addOfficeHoursSeconds(weekdays, new Date('2026-01-09T16:00:00Z'), 2 * 3600))).toBe(
      '2026-01-12T10:00:00.000Z'
    )
  })

  it('is DST-correct: the same local rule across the offset change', () => {
    const ny = {
      timezone: 'America/New_York',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    }
    // Winter (EST, UTC-5): Mon 09:00 EST = 14:00Z; +1h -> 10:00 EST = 15:00Z.
    expect(iso(addOfficeHoursSeconds(ny, new Date('2026-01-05T14:00:00Z'), 3600))).toBe(
      '2026-01-05T15:00:00.000Z'
    )
    // Summer (EDT, UTC-4): Mon 09:00 EDT = 13:00Z; +1h -> 10:00 EDT = 14:00Z.
    expect(iso(addOfficeHoursSeconds(ny, new Date('2026-07-06T13:00:00Z'), 3600))).toBe(
      '2026-07-06T14:00:00.000Z'
    )
  })
})

// ---------------------------------------------------------------------------
// Settings-blob schedule → engine shape
// ---------------------------------------------------------------------------

describe('engineScheduleFromWorkspace', () => {
  it('maps a disabled schedule to 24/7 (no windows)', () => {
    const engine = engineScheduleFromWorkspace({
      enabled: false,
      timezone: 'Europe/Berlin',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    })
    expect(engine.intervals).toEqual([])
  })

  it('passes same-day windows through with the schedule timezone', () => {
    const engine = engineScheduleFromWorkspace({
      enabled: true,
      timezone: 'Europe/Berlin',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    })
    expect(engine).toEqual({
      timezone: 'Europe/Berlin',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    })
  })

  it('splits an overnight window at midnight so the engine keeps its full span', () => {
    const engine = engineScheduleFromWorkspace({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 6, start: '22:00', end: '06:00' }], // Sat night into Sunday
    })
    expect(engine.intervals).toEqual([
      { day: 6, start: '22:00', end: '24:00' },
      { day: 0, start: '00:00', end: '06:00' },
    ])
    // The engine resolves both halves as open time.
    // 2026-01-10 is a Saturday; 23:00 Sat and 03:00 Sun are inside.
    expect(isWithinOfficeHours(engine, new Date('2026-01-10T23:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(engine, new Date('2026-01-11T03:00:00Z'))).toBe(true)
    // 12:00 Sunday is outside.
    expect(isWithinOfficeHours(engine, new Date('2026-01-11T12:00:00Z'))).toBe(false)
  })

  it('drops malformed windows; an enabled schedule with none left is 24/7', () => {
    const engine = engineScheduleFromWorkspace({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 1, start: 'bad', end: 'worse' }],
    })
    expect(engine.intervals).toEqual([])
    // Empty windows = 24/7 to the clock: a deadline must always land.
    expect(
      addOfficeHoursSeconds(engine, new Date('2026-01-05T10:00:00Z'), 3600).toISOString()
    ).toBe('2026-01-05T11:00:00.000Z')
  })

  it("the split '24:00' close runs to (exclusive) midnight in the clock walk", () => {
    // Sat 22:00-24:00 only: 1h from Sat 23:00 must finish at midnight sharp...
    const engine = engineScheduleFromWorkspace({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 6, start: '22:00', end: '00:00' }], // legacy-style end-of-day
    })
    expect(engine.intervals).toEqual([{ day: 6, start: '22:00', end: '24:00' }])
    expect(
      addOfficeHoursSeconds(engine, new Date('2026-01-10T23:00:00Z'), 3600).toISOString()
    ).toBe('2026-01-11T00:00:00.000Z')
    // ...and 2h spills into NEXT Saturday's window (only window all week).
    expect(
      addOfficeHoursSeconds(engine, new Date('2026-01-10T23:00:00Z'), 2 * 3600).toISOString()
    ).toBe('2026-01-17T23:00:00.000Z')
  })
})
