import { describe, it, expect, afterEach, vi } from 'vitest'
import { DATE_PRESETS, getDateFromDaysAgo } from '../filter-presets'

/**
 * Date presets are computed from the viewer's local clock, so a preset that
 * looks right in UTC can silently be a day off elsewhere. These cases pin one
 * timezone either side of UTC at a time of day where an off-by-one shows up:
 * evening in the Americas, morning in Australia.
 */

const originalTz = process.env.TZ

function withTimezone(tz: string, at: Date, fn: () => void) {
  process.env.TZ = tz
  vi.useFakeTimers()
  vi.setSystemTime(at)
  try {
    fn()
  } finally {
    vi.useRealTimers()
    process.env.TZ = originalTz
  }
}

/** Whole days between two YYYY-MM-DD strings, compared as plain calendar dates. */
function calendarDaysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`)
  const b = Date.parse(`${later}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

afterEach(() => {
  process.env.TZ = originalTz
})

describe('getDateFromDaysAgo', () => {
  it('returns today for the 0-day preset, in a negative UTC offset', () => {
    // 2026-07-27T00:30Z is still 2026-07-26 20:30 in New York.
    withTimezone('America/New_York', new Date('2026-07-27T00:30:00Z'), () => {
      expect(getDateFromDaysAgo(0)).toBe('2026-07-26')
    })
  })

  it('returns today for the 0-day preset, in a positive UTC offset', () => {
    // 2026-07-25T23:30Z is already 2026-07-26 09:30 in Sydney.
    withTimezone('Australia/Sydney', new Date('2026-07-25T23:30:00Z'), () => {
      expect(getDateFromDaysAgo(0)).toBe('2026-07-26')
    })
  })

  it('counts back whole calendar days in the evening, west of UTC', () => {
    withTimezone('America/New_York', new Date('2026-07-27T00:30:00Z'), () => {
      expect(getDateFromDaysAgo(7)).toBe('2026-07-19')
      expect(getDateFromDaysAgo(30)).toBe('2026-06-26')
      expect(getDateFromDaysAgo(90)).toBe('2026-04-27')
    })
  })

  it('counts back whole calendar days in the morning, east of UTC', () => {
    withTimezone('Australia/Sydney', new Date('2026-07-25T23:30:00Z'), () => {
      expect(getDateFromDaysAgo(7)).toBe('2026-07-19')
      expect(getDateFromDaysAgo(30)).toBe('2026-06-26')
      expect(getDateFromDaysAgo(90)).toBe('2026-04-27')
    })
  })

  it('keeps every preset an exact number of days behind today', () => {
    for (const tz of ['America/New_York', 'Australia/Sydney', 'UTC']) {
      for (const iso of ['2026-07-26T00:30:00Z', '2026-07-26T12:00:00Z', '2026-07-26T23:30:00Z']) {
        withTimezone(tz, new Date(iso), () => {
          const today = getDateFromDaysAgo(0)
          for (const preset of DATE_PRESETS) {
            expect(calendarDaysBetween(getDateFromDaysAgo(preset.daysAgo), today)).toBe(
              preset.daysAgo
            )
          }
        })
      }
    }
  })
})
