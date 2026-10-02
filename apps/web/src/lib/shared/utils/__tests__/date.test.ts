import { describe, it, expect } from 'vitest'
import {
  formatCalendarDate,
  formatMonthYear,
  parseCalendarDate,
  toIsoString,
  toIsoStringOrNull,
  toIsoDateOnly,
} from '..'

describe('toIsoString', () => {
  it('converts a Date object to ISO string', () => {
    const date = new Date('2025-06-15T12:00:00.000Z')
    expect(toIsoString(date)).toBe('2025-06-15T12:00:00.000Z')
  })

  it('handles dates at epoch', () => {
    const epoch = new Date(0)
    expect(toIsoString(epoch)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('handles dates with time components', () => {
    const date = new Date('2025-12-31T23:59:59.999Z')
    expect(toIsoString(date)).toBe('2025-12-31T23:59:59.999Z')
  })

  it('returns the string as-is when given a string', () => {
    const iso = '2025-06-15T12:00:00.000Z'
    expect(toIsoString(iso)).toBe(iso)
  })
})

describe('toIsoStringOrNull', () => {
  it('returns ISO string for a valid Date', () => {
    const date = new Date('2025-06-15T12:00:00.000Z')
    expect(toIsoStringOrNull(date)).toBe('2025-06-15T12:00:00.000Z')
  })

  it('returns null for null input', () => {
    expect(toIsoStringOrNull(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(toIsoStringOrNull(undefined)).toBeNull()
  })

  it('returns the string as-is when given a string', () => {
    const iso = '2025-06-15T12:00:00.000Z'
    expect(toIsoStringOrNull(iso)).toBe(iso)
  })
})

describe('toIsoDateOnly', () => {
  it('extracts date-only portion', () => {
    expect(toIsoDateOnly(new Date('2026-02-23T15:30:00Z'))).toBe('2026-02-23')
  })

  it('handles start of day', () => {
    expect(toIsoDateOnly(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01')
  })

  it('handles end of day', () => {
    expect(toIsoDateOnly(new Date('2025-12-31T23:59:59.999Z'))).toBe('2025-12-31')
  })
})

describe('parseCalendarDate', () => {
  it('reads a date-only value as the UTC midnight that names it', () => {
    expect(parseCalendarDate('2026-10-01')?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('reads the date as written in an ISO timestamp', () => {
    expect(parseCalendarDate('2026-10-01T23:30:00-07:00')?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z'
    )
  })

  it('is null for a value that is not a real calendar date', () => {
    expect(parseCalendarDate('2026-02-31')).toBeNull()
    expect(parseCalendarDate('October 1')).toBeNull()
    expect(parseCalendarDate('')).toBeNull()
  })
})

describe('formatCalendarDate', () => {
  it('shows the same day in every runtime zone', () => {
    const realTz = process.env.TZ
    try {
      for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
        process.env.TZ = zone
        expect(formatCalendarDate('2026-10-01')).toBe('Oct 1, 2026')
      }
    } finally {
      process.env.TZ = realTz
    }
  })

  it('takes options and a locale', () => {
    expect(formatCalendarDate('2026-10-01', { month: 'long', day: 'numeric' }, 'de-DE')).toBe(
      '1. Oktober'
    )
  })

  it('is null for a value that is not a calendar date', () => {
    expect(formatCalendarDate('soon')).toBeNull()
  })
})

describe('formatMonthYear', () => {
  it('formats the UTC month in English by default', () => {
    expect(formatMonthYear('2027-03-01T00:00:00.000Z')).toBe('Mar 2027')
  })

  it('formats the UTC month in a given locale', () => {
    expect(formatMonthYear('2027-03-01T00:00:00.000Z', 'pl')).toBe(
      new Intl.DateTimeFormat('pl', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date('2027-03-01T00:00:00.000Z')
      )
    )
    expect(formatMonthYear('2027-03-01T00:00:00.000Z', 'de')).not.toBe('Mar 2027')
  })

  it('is null for a missing or invalid value', () => {
    expect(formatMonthYear(null)).toBeNull()
    expect(formatMonthYear('not a date', 'pl')).toBeNull()
  })
})
