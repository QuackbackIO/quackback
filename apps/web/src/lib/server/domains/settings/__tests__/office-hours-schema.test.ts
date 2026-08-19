import { describe, expect, it } from 'vitest'
import { officeHoursScheduleSchema, DEFAULT_OFFICE_HOURS_SCHEDULE } from '../settings.office-hours'

describe('officeHoursScheduleSchema', () => {
  it('accepts a disabled (24/7) default', () => {
    expect(officeHoursScheduleSchema.safeParse(DEFAULT_OFFICE_HOURS_SCHEDULE).success).toBe(true)
  })

  it('accepts a well-formed weekday schedule', () => {
    const ok = officeHoursScheduleSchema.safeParse({
      enabled: true,
      timezone: 'America/New_York',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    })
    expect(ok.success).toBe(true)
  })

  it('accepts an overnight window (end < start)', () => {
    const ok = officeHoursScheduleSchema.safeParse({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 5, start: '22:00', end: '06:00' }],
    })
    expect(ok.success).toBe(true)
  })

  it('rejects an unknown IANA timezone', () => {
    const bad = officeHoursScheduleSchema.safeParse({
      enabled: true,
      timezone: 'Not/AZone',
      intervals: [],
    })
    expect(bad.success).toBe(false)
  })

  it('rejects a malformed time', () => {
    const bad = officeHoursScheduleSchema.safeParse({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 1, start: '9:00', end: '25:00' }],
    })
    expect(bad.success).toBe(false)
  })

  it('rejects an interval whose start equals its end', () => {
    const bad = officeHoursScheduleSchema.safeParse({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 1, start: '09:00', end: '09:00' }],
    })
    expect(bad.success).toBe(false)
  })

  it('rejects an out-of-range weekday', () => {
    const bad = officeHoursScheduleSchema.safeParse({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 7, start: '09:00', end: '17:00' }],
    })
    expect(bad.success).toBe(false)
  })

  it('defaults holidays to [] when the key is absent', () => {
    const parsed = officeHoursScheduleSchema.parse({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    })
    expect(parsed.holidays).toEqual([])
  })

  it('accepts holidays and fills recurringAnnual to false', () => {
    const parsed = officeHoursScheduleSchema.parse({
      enabled: true,
      timezone: 'UTC',
      intervals: [],
      holidays: [
        { date: '2026-12-25', name: 'Christmas' },
        { date: '2026-01-01', recurringAnnual: true },
      ],
    })
    expect(parsed.holidays).toEqual([
      { date: '2026-12-25', name: 'Christmas', recurringAnnual: false },
      { date: '2026-01-01', recurringAnnual: true },
    ])
  })

  it('rejects a malformed holiday date', () => {
    for (const date of ['2026-13-01', '2026-1-05', '25-12-2026', 'not-a-date']) {
      const bad = officeHoursScheduleSchema.safeParse({
        enabled: true,
        timezone: 'UTC',
        intervals: [],
        holidays: [{ date }],
      })
      expect(bad.success).toBe(false)
    }
  })
})
