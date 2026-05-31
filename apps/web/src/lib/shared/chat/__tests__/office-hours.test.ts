import { describe, expect, it } from 'vitest'
import { isWithinOfficeHours } from '../office-hours'
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
