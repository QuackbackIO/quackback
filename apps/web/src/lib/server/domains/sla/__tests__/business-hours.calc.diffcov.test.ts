/**
 * Differential-coverage tests for business-hours.calc — the pure
 * timezone-aware business-time math: within-hours checks, add/subtract across
 * range boundaries and day rollovers, elapsed-time accumulation, and the
 * timezone/range/schedule/holiday validators. No mocks (the module is pure).
 */
import { describe, it, expect } from 'vitest'
import {
  isWithinBusinessHours,
  addBusinessMinutes,
  subtractBusinessMinutes,
  elapsedBusinessMs,
  isValidTimezone,
  validateRange,
  validateSchedule,
  validateHolidays,
} from '../business-hours.calc'

const week = {
  sun: [],
  mon: [
    { start: '09:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
}
const hours = {
  timezone: 'UTC',
  schedule: week as never,
  holidays: [{ date: '2026-06-25' }] as never,
}
// 2026-06-22 is a Monday (UTC).
const at = (iso: string) => new Date(`${iso}Z`)

describe('isWithinBusinessHours', () => {
  it('is always true for 24/7 (null hours)', () => {
    expect(isWithinBusinessHours(at('2026-06-20T03:00:00'), null)).toBe(true)
  })
  it('is true inside an open range', () => {
    expect(isWithinBusinessHours(at('2026-06-22T10:00:00'), hours)).toBe(true)
  })
  it('is false in the lunch gap and on closed days', () => {
    expect(isWithinBusinessHours(at('2026-06-22T12:30:00'), hours)).toBe(false) // between ranges
    expect(isWithinBusinessHours(at('2026-06-20T10:00:00'), hours)).toBe(false) // Saturday (no ranges)
  })
  it('is false on a holiday', () => {
    expect(isWithinBusinessHours(at('2026-06-25T10:00:00'), hours)).toBe(false) // Thu holiday
  })
})

describe('addBusinessMinutes', () => {
  it('adds linearly for 24/7', () => {
    expect(addBusinessMinutes(at('2026-06-22T10:00:00'), 30, null).toISOString()).toBe(
      at('2026-06-22T10:30:00').toISOString()
    )
  })
  it('returns the start for non-positive minutes', () => {
    expect(addBusinessMinutes(at('2026-06-22T10:00:00'), 0, hours).toISOString()).toBe(
      at('2026-06-22T10:00:00').toISOString()
    )
  })
  it('lands inside the same range', () => {
    expect(addBusinessMinutes(at('2026-06-22T09:00:00'), 60, hours).toISOString()).toBe(
      at('2026-06-22T10:00:00').toISOString()
    )
  })
  it('rolls across the lunch gap and into the next day', () => {
    // Mon 11:30 + 120 business min: 30 to 12:00, skip lunch, 90 in 13:00-14:30.
    expect(addBusinessMinutes(at('2026-06-22T11:30:00'), 120, hours).toISOString()).toBe(
      at('2026-06-22T14:30:00').toISOString()
    )
    // Mon 16:00 + 120: 60 to 17:00, then 60 on Tue 09:00-10:00.
    expect(addBusinessMinutes(at('2026-06-22T16:00:00'), 120, hours).toISOString()).toBe(
      at('2026-06-23T10:00:00').toISOString()
    )
  })
  it('starts before opening (effStart clamps to range start)', () => {
    expect(addBusinessMinutes(at('2026-06-23T06:00:00'), 60, hours).toISOString()).toBe(
      at('2026-06-23T10:00:00').toISOString()
    )
  })
})

describe('subtractBusinessMinutes', () => {
  it('subtracts linearly for 24/7 and returns end for non-positive', () => {
    expect(subtractBusinessMinutes(at('2026-06-22T10:00:00'), 30, null).toISOString()).toBe(
      at('2026-06-22T09:30:00').toISOString()
    )
    expect(subtractBusinessMinutes(at('2026-06-22T10:00:00'), 0, hours).toISOString()).toBe(
      at('2026-06-22T10:00:00').toISOString()
    )
  })
  it('lands inside the same range', () => {
    expect(subtractBusinessMinutes(at('2026-06-23T16:00:00'), 60, hours).toISOString()).toBe(
      at('2026-06-23T15:00:00').toISOString()
    )
  })
  it('walks back across days', () => {
    // Tue 09:30 - 60: 30 back to Tue 09:00, then 30 on Mon ending 17:00 -> 16:30.
    expect(subtractBusinessMinutes(at('2026-06-23T09:30:00'), 60, hours).toISOString()).toBe(
      at('2026-06-22T16:30:00').toISOString()
    )
  })
})

describe('elapsedBusinessMs', () => {
  it('is 0 when end <= start', () => {
    expect(elapsedBusinessMs(at('2026-06-22T11:00:00'), at('2026-06-22T10:00:00'), hours)).toBe(0)
  })
  it('is the raw diff for 24/7', () => {
    expect(elapsedBusinessMs(at('2026-06-22T10:00:00'), at('2026-06-22T11:00:00'), null)).toBe(
      3_600_000
    )
  })
  it('accumulates within a single day, clipping to end', () => {
    // Mon 10:00 -> 11:00 inside first range = 60 min.
    expect(elapsedBusinessMs(at('2026-06-22T10:00:00'), at('2026-06-22T11:00:00'), hours)).toBe(
      60 * 60_000
    )
  })
  it('accumulates across multiple days', () => {
    // Mon 16:00 -> Tue 10:00: 60 (Mon 16-17) + 60 (Tue 09-10) = 120 min.
    expect(elapsedBusinessMs(at('2026-06-22T16:00:00'), at('2026-06-23T10:00:00'), hours)).toBe(
      120 * 60_000
    )
  })
})

describe('validators', () => {
  it('isValidTimezone accepts IANA and rejects junk', () => {
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
  })
  it('validateRange accepts valid and rejects bad format / inverted', () => {
    expect(() => validateRange({ start: '09:00', end: '17:00' } as never)).not.toThrow()
    expect(() => validateRange({ start: '9am', end: '5pm' } as never)).toThrow('invalid HH:MM')
    expect(() => validateRange({ start: '17:00', end: '09:00' } as never)).toThrow('before end')
  })
  it('validateSchedule rejects overlapping ranges', () => {
    expect(() => validateSchedule(week as never)).not.toThrow()
    expect(() =>
      validateSchedule({
        ...week,
        mon: [
          { start: '09:00', end: '12:00' },
          { start: '11:00', end: '13:00' },
        ],
      } as never)
    ).toThrow('overlapping')
  })
  it('validateHolidays accepts valid dates and rejects bad ones', () => {
    expect(() => validateHolidays([{ date: '2026-12-25' }] as never)).not.toThrow()
    expect(() => validateHolidays([{ date: '2026/12/25' }] as never)).toThrow('invalid holiday')
    expect(() => validateHolidays([{ date: '2026-13-40' }] as never)).toThrow('invalid holiday')
  })
})
