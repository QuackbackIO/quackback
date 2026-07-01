import { describe, expect, it } from 'vitest'
import { isWithinOfficeHours, nextOpenAt } from '../office-hours'
import type { OfficeHoursConfig } from '../types'

/** Mon–Fri 09:00–17:00, weekends closed, in the given timezone. */
function weekdays9to5(timezone: string, enabled = true): OfficeHoursConfig {
  return {
    enabled,
    timezone,
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      enabled: d >= 1 && d <= 5,
      start: '09:00',
      end: '17:00',
    })),
  }
}

// 2026-01-05 is a Monday; 2026-01-04 is a Sunday.
describe('isWithinOfficeHours', () => {
  it('returns false when disabled', () => {
    expect(isWithinOfficeHours(weekdays9to5('UTC', false), new Date('2026-01-05T12:00:00Z'))).toBe(
      false
    )
  })

  it('is open midday on a weekday (UTC)', () => {
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-05T12:00:00Z'))).toBe(true)
  })

  it('is closed before opening on a weekday', () => {
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-05T08:59:00Z'))).toBe(false)
  })

  it('treats the closing time as exclusive', () => {
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-05T17:00:00Z'))).toBe(false)
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-05T16:59:00Z'))).toBe(true)
  })

  it('is closed on a disabled weekday (Sunday)', () => {
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-04T12:00:00Z'))).toBe(false)
  })

  it('evaluates the configured timezone, not UTC', () => {
    const ny = weekdays9to5('America/New_York')
    // 14:00Z on Mon = 09:00 EST → open; 13:59Z = 08:59 EST → closed.
    expect(isWithinOfficeHours(ny, new Date('2026-01-05T14:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(ny, new Date('2026-01-05T13:59:00Z'))).toBe(false)
    // 22:00Z Mon = 17:00 EST → closed (exclusive end).
    expect(isWithinOfficeHours(ny, new Date('2026-01-05T22:00:00Z'))).toBe(false)
  })

  it('crosses the local day boundary correctly', () => {
    const ny = weekdays9to5('America/New_York')
    // 2026-01-05T03:00:00Z = Sun 22:00 EST → weekend, closed.
    expect(isWithinOfficeHours(ny, new Date('2026-01-05T03:00:00Z'))).toBe(false)
  })

  it('uses the LOCAL weekday, not the UTC weekday', () => {
    // A discriminating instant: 2026-01-10T04:00:00Z is Saturday 04:00 in UTC
    // but Friday 23:00 in New York. With Fri open until 24:00 it must read OPEN
    // locally; a UTC-day implementation would see Saturday (closed) and a
    // 17:00 close would also wrongly read closed — so this only passes with
    // correct local-day + open-late evaluation.
    const friLate: OfficeHoursConfig = {
      enabled: true,
      timezone: 'America/New_York',
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        enabled: d === 5,
        start: '09:00',
        end: '00:00',
      })),
    }
    expect(isWithinOfficeHours(friLate, new Date('2026-01-10T04:00:00Z'))).toBe(true)
  })

  it('treats an end of 00:00 as midnight / end-of-day, not closed-all-day', () => {
    const tillMidnight: OfficeHoursConfig = {
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: true, start: '09:00', end: '00:00' })),
    }
    // 23:00 is inside 09:00–24:00.
    expect(isWithinOfficeHours(tillMidnight, new Date('2026-01-05T23:00:00Z'))).toBe(true)
    // 08:00 is still before opening.
    expect(isWithinOfficeHours(tillMidnight, new Date('2026-01-05T08:00:00Z'))).toBe(false)
  })

  it('fails closed on an unknown timezone', () => {
    expect(isWithinOfficeHours(weekdays9to5('Not/AZone'), new Date('2026-01-05T12:00:00Z'))).toBe(
      false
    )
  })

  it('rejects malformed or inverted ranges', () => {
    const bad: OfficeHoursConfig = {
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: true, start: '17:00', end: '09:00' })),
    }
    expect(isWithinOfficeHours(bad, new Date('2026-01-05T12:00:00Z'))).toBe(false)

    const malformed: OfficeHoursConfig = {
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: true, start: 'oops', end: '17:00' })),
    }
    expect(isWithinOfficeHours(malformed, new Date('2026-01-05T12:00:00Z'))).toBe(false)
  })
})

// 2026-06-03 is a Wednesday, 2026-06-05 a Friday, 2026-06-08 a Monday.
describe('nextOpenAt', () => {
  it('returns null when disabled or every day is off', () => {
    expect(nextOpenAt(weekdays9to5('UTC', false), new Date('2026-06-03T07:00:00Z'))).toBeNull()
    const allOff: OfficeHoursConfig = {
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: false, start: '09:00', end: '17:00' })),
    }
    expect(nextOpenAt(allOff, new Date('2026-06-03T07:00:00Z'))).toBeNull()
  })

  it('returns today opening when before the start (UTC)', () => {
    const at = nextOpenAt(weekdays9to5('UTC'), new Date('2026-06-03T07:00:00Z'))
    expect(at?.toISOString()).toBe('2026-06-03T09:00:00.000Z')
  })

  it('skips today once the window has begun → next weekday', () => {
    // 12:00 is within hours; 18:00 is after — both should point at Thursday.
    expect(nextOpenAt(weekdays9to5('UTC'), new Date('2026-06-03T12:00:00Z'))?.toISOString()).toBe(
      '2026-06-04T09:00:00.000Z'
    )
    expect(nextOpenAt(weekdays9to5('UTC'), new Date('2026-06-03T18:00:00Z'))?.toISOString()).toBe(
      '2026-06-04T09:00:00.000Z'
    )
  })

  it('jumps the closed weekend to Monday', () => {
    const at = nextOpenAt(weekdays9to5('UTC'), new Date('2026-06-05T18:00:00Z'))
    expect(at?.toISOString()).toBe('2026-06-08T09:00:00.000Z')
  })

  it('resolves the opening instant in the config timezone', () => {
    // 09:00 in Kolkata (UTC+5:30) is 03:30 UTC; now is 07:30 IST, before open.
    const at = nextOpenAt(weekdays9to5('Asia/Kolkata'), new Date('2026-06-03T02:00:00Z'))
    expect(at?.toISOString()).toBe('2026-06-03T03:30:00.000Z')
  })

  it('returns null for an unknown timezone', () => {
    expect(nextOpenAt(weekdays9to5('Not/AZone'), new Date('2026-06-03T07:00:00Z'))).toBeNull()
  })
})

// Regression cases from the deep review (single-enabled-day; degenerate window).
describe('nextOpenAt — edge schedules', () => {
  function singleDay(dayIndex: number, start: string, end: string): OfficeHoursConfig {
    return {
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ enabled: d === dayIndex, start, end })),
    }
  }

  it('rolls a single-enabled-day schedule to the same day next week once today has started', () => {
    // Only Wednesday open; now is Wed 18:00 (after the window) → next Wed.
    const at = nextOpenAt(singleDay(3, '09:00', '17:00'), new Date('2026-06-03T18:00:00Z'))
    expect(at?.toISOString()).toBe('2026-06-10T09:00:00.000Z')
  })

  it('still returns today for a single-enabled-day schedule before the window starts', () => {
    const at = nextOpenAt(singleDay(3, '09:00', '17:00'), new Date('2026-06-03T07:00:00Z'))
    expect(at?.toISOString()).toBe('2026-06-03T09:00:00.000Z')
  })

  it('skips degenerate windows (end <= start) it would never actually open', () => {
    const allDegenerate: OfficeHoursConfig = {
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: true, start: '09:00', end: '09:00' })),
    }
    expect(nextOpenAt(allDegenerate, new Date('2026-06-03T07:00:00Z'))).toBeNull()
  })
})
