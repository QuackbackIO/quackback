import { describe, expect, it } from 'vitest'
import { resolveOfficeHoursSchedule } from '../settings.office-hours'
import { DEFAULT_OFFICE_HOURS_SCHEDULE } from '@/lib/shared/office-hours'

/** Raw widget-config JSON carrying a released messenger.officeHours blob. */
function widgetConfigWithLegacy(enabled: boolean): string {
  return JSON.stringify({
    enabled: true,
    messenger: {
      enabled: true,
      officeHours: {
        enabled,
        timezone: 'America/New_York',
        days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          enabled: d >= 1 && d <= 5,
          start: '09:00',
          end: '17:00',
        })),
      },
    },
  })
}

describe('resolveOfficeHoursSchedule', () => {
  it('defaults to 24/7 when neither store has a schedule', () => {
    expect(resolveOfficeHoursSchedule(null, null)).toEqual(DEFAULT_OFFICE_HOURS_SCHEDULE)
    expect(resolveOfficeHoursSchedule('{}', '{}')).toEqual(DEFAULT_OFFICE_HOURS_SCHEDULE)
  })

  it('returns the canonical metadata schedule when present', () => {
    const meta = JSON.stringify({
      officeHours: {
        enabled: true,
        timezone: 'UTC',
        intervals: [{ day: 1, start: '10:00', end: '16:00' }],
      },
    })
    expect(resolveOfficeHoursSchedule(meta, widgetConfigWithLegacy(true))).toEqual({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 1, start: '10:00', end: '16:00' }],
      holidays: [],
    })
  })

  it('lets an explicit disabled metadata schedule win over legacy (no fallback)', () => {
    // An admin who saved through the new page (even to 24/7) must not be
    // overridden by the released legacy config.
    const meta = JSON.stringify({ officeHours: DEFAULT_OFFICE_HOURS_SCHEDULE })
    expect(resolveOfficeHoursSchedule(meta, widgetConfigWithLegacy(true))).toEqual(
      DEFAULT_OFFICE_HOURS_SCHEDULE
    )
  })

  it('falls back to the converted legacy schedule when the metadata key is absent', () => {
    const schedule = resolveOfficeHoursSchedule(null, widgetConfigWithLegacy(true))
    expect(schedule.enabled).toBe(true)
    expect(schedule.timezone).toBe('America/New_York')
    expect(schedule.intervals).toEqual([
      { day: 1, start: '09:00', end: '17:00' },
      { day: 2, start: '09:00', end: '17:00' },
      { day: 3, start: '09:00', end: '17:00' },
      { day: 4, start: '09:00', end: '17:00' },
      { day: 5, start: '09:00', end: '17:00' },
    ])
  })

  it('ignores a disabled legacy schedule and stays 24/7', () => {
    expect(resolveOfficeHoursSchedule(null, widgetConfigWithLegacy(false))).toEqual(
      DEFAULT_OFFICE_HOURS_SCHEDULE
    )
  })

  it('falls back on unparseable metadata rather than throwing', () => {
    expect(resolveOfficeHoursSchedule('not json', widgetConfigWithLegacy(true)).enabled).toBe(true)
  })
})
