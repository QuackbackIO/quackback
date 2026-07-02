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
})
