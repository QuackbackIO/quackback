import { describe, expect, it } from 'vitest'
import {
  addBusinessMinutes,
  subtractBusinessMinutes,
  elapsedBusinessMs,
  isWithinBusinessHours,
  isValidTimezone,
  validateRange,
  validateSchedule,
  validateHolidays,
  type BusinessHoursLike,
} from '../business-hours.calc'

const NINE_TO_FIVE_UTC_WEEKDAYS: BusinessHoursLike = {
  timezone: 'UTC',
  schedule: {
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
    sat: [],
    sun: [],
  },
  holidays: [],
}

describe('business-hours calc', () => {
  describe('24/7 short-circuit', () => {
    it('addBusinessMinutes with null hours adds raw minutes', () => {
      const start = new Date('2026-01-05T10:00:00Z')
      const out = addBusinessMinutes(start, 90, null)
      expect(out.toISOString()).toBe('2026-01-05T11:30:00.000Z')
    })

    it('subtractBusinessMinutes with null hours subtracts raw minutes', () => {
      const end = new Date('2026-01-05T10:00:00Z')
      const out = subtractBusinessMinutes(end, 60, null)
      expect(out.toISOString()).toBe('2026-01-05T09:00:00.000Z')
    })

    it('elapsedBusinessMs with null hours is wall-clock diff', () => {
      const a = new Date('2026-01-05T10:00:00Z')
      const b = new Date('2026-01-05T10:30:00Z')
      expect(elapsedBusinessMs(a, b, null)).toBe(30 * 60_000)
    })

    it('isWithinBusinessHours with null hours is always true', () => {
      expect(isWithinBusinessHours(new Date(), null)).toBe(true)
    })
  })

  describe('addBusinessMinutes (9-5 UTC, weekdays)', () => {
    it('adds within the same day', () => {
      // Mon 2026-01-05 10:00 UTC + 60 = 11:00 UTC
      const start = new Date('2026-01-05T10:00:00Z')
      const out = addBusinessMinutes(start, 60, NINE_TO_FIVE_UTC_WEEKDAYS)
      expect(out.toISOString()).toBe('2026-01-05T11:00:00.000Z')
    })

    it('clamps a pre-business start to opening time', () => {
      // Mon 2026-01-05 06:00 UTC + 60 = clamps to 09:00, then +60 = 10:00 UTC
      const start = new Date('2026-01-05T06:00:00Z')
      const out = addBusinessMinutes(start, 60, NINE_TO_FIVE_UTC_WEEKDAYS)
      expect(out.toISOString()).toBe('2026-01-05T10:00:00.000Z')
    })

    it('rolls past end of day to next morning', () => {
      // Mon 2026-01-05 16:30 UTC + 60 = 30 min Mon (to 17:00) + 30 min Tue from 09:00 = Tue 09:30
      const start = new Date('2026-01-05T16:30:00Z')
      const out = addBusinessMinutes(start, 60, NINE_TO_FIVE_UTC_WEEKDAYS)
      expect(out.toISOString()).toBe('2026-01-06T09:30:00.000Z')
    })

    it('skips weekends', () => {
      // Fri 2026-01-09 16:30 UTC + 60 = 30 min Fri (to 17:00) + 30 min Mon 2026-01-12 from 09:00
      const start = new Date('2026-01-09T16:30:00Z')
      const out = addBusinessMinutes(start, 60, NINE_TO_FIVE_UTC_WEEKDAYS)
      expect(out.toISOString()).toBe('2026-01-12T09:30:00.000Z')
    })

    it('skips holidays', () => {
      const hours: BusinessHoursLike = {
        ...NINE_TO_FIVE_UTC_WEEKDAYS,
        holidays: [{ date: '2026-01-06' }],
      }
      // Mon 2026-01-05 16:30 UTC + 60 = 30 min Mon, then skip Tue holiday, +30 min Wed 09:00
      const start = new Date('2026-01-05T16:30:00Z')
      const out = addBusinessMinutes(start, 60, hours)
      expect(out.toISOString()).toBe('2026-01-07T09:30:00.000Z')
    })

    it('returns input when minutes <= 0', () => {
      const start = new Date('2026-01-05T10:00:00Z')
      expect(addBusinessMinutes(start, 0, NINE_TO_FIVE_UTC_WEEKDAYS).getTime()).toBe(
        start.getTime()
      )
    })

    it('falls back to linear time when no business ranges are open for a year', () => {
      const closed: BusinessHoursLike = {
        timezone: 'UTC',
        schedule: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        holidays: [],
      }
      const start = new Date('2026-01-05T10:00:00Z')
      const out = addBusinessMinutes(start, 45, closed)
      expect(out.toISOString()).toBe('2026-01-05T10:45:00.000Z')
    })

    it('moves to the next open range when the start is after closing time', () => {
      const start = new Date('2026-01-05T18:00:00Z')
      const out = addBusinessMinutes(start, 30, NINE_TO_FIVE_UTC_WEEKDAYS)
      expect(out.toISOString()).toBe('2026-01-06T09:30:00.000Z')
    })
  })

  describe('subtractBusinessMinutes', () => {
    it('subtracts within the same day', () => {
      const end = new Date('2026-01-05T11:00:00Z')
      const out = subtractBusinessMinutes(end, 60, NINE_TO_FIVE_UTC_WEEKDAYS)
      expect(out.toISOString()).toBe('2026-01-05T10:00:00.000Z')
    })

    it('rolls back to previous business day', () => {
      // Tue 2026-01-06 09:30 UTC - 60 = 30 min Tue (to 09:00) + 30 min Mon (to 16:30)
      const end = new Date('2026-01-06T09:30:00Z')
      const out = subtractBusinessMinutes(end, 60, NINE_TO_FIVE_UTC_WEEKDAYS)
      expect(out.toISOString()).toBe('2026-01-05T16:30:00.000Z')
    })

    it('returns input when minutes <= 0', () => {
      const end = new Date('2026-01-05T11:00:00Z')
      expect(subtractBusinessMinutes(end, 0, NINE_TO_FIVE_UTC_WEEKDAYS).getTime()).toBe(
        end.getTime()
      )
    })

    it('falls back to linear time when no prior business ranges are open for a year', () => {
      const closed: BusinessHoursLike = {
        timezone: 'UTC',
        schedule: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        holidays: [],
      }
      const end = new Date('2026-01-05T10:00:00Z')
      const out = subtractBusinessMinutes(end, 45, closed)
      expect(out.toISOString()).toBe('2026-01-05T09:15:00.000Z')
    })

    it('moves to the previous open range when the end is before opening time', () => {
      const end = new Date('2026-01-06T06:00:00Z')
      const out = subtractBusinessMinutes(end, 30, NINE_TO_FIVE_UTC_WEEKDAYS)
      expect(out.toISOString()).toBe('2026-01-05T16:30:00.000Z')
    })
  })

  describe('elapsedBusinessMs', () => {
    it('returns 0 when end <= start', () => {
      const t = new Date('2026-01-05T10:00:00Z')
      expect(elapsedBusinessMs(t, t, NINE_TO_FIVE_UTC_WEEKDAYS)).toBe(0)
    })

    it('counts only minutes within business hours', () => {
      // Mon 2026-01-05 16:00 UTC → Tue 2026-01-06 10:00 UTC
      // = 60 min (16:00-17:00 Mon) + 60 min (09:00-10:00 Tue) = 120 min
      const start = new Date('2026-01-05T16:00:00Z')
      const end = new Date('2026-01-06T10:00:00Z')
      expect(elapsedBusinessMs(start, end, NINE_TO_FIVE_UTC_WEEKDAYS)).toBe(120 * 60_000)
    })

    it('skips weekends in elapsed calc', () => {
      // Fri 2026-01-09 16:00 UTC → Mon 2026-01-12 10:00 UTC
      // = 60 min Fri + 60 min Mon = 120 min
      const start = new Date('2026-01-09T16:00:00Z')
      const end = new Date('2026-01-12T10:00:00Z')
      expect(elapsedBusinessMs(start, end, NINE_TO_FIVE_UTC_WEEKDAYS)).toBe(120 * 60_000)
    })

    it('skips ranges that end before the effective start', () => {
      const start = new Date('2026-01-05T18:00:00Z')
      const end = new Date('2026-01-06T08:00:00Z')
      expect(elapsedBusinessMs(start, end, NINE_TO_FIVE_UTC_WEEKDAYS)).toBe(0)
    })
  })

  describe('isWithinBusinessHours', () => {
    it('true on a weekday at noon', () => {
      expect(
        isWithinBusinessHours(new Date('2026-01-05T12:00:00Z'), NINE_TO_FIVE_UTC_WEEKDAYS)
      ).toBe(true)
    })

    it('false on a weekend', () => {
      expect(
        isWithinBusinessHours(new Date('2026-01-10T12:00:00Z'), NINE_TO_FIVE_UTC_WEEKDAYS)
      ).toBe(false)
    })

    it('false outside the daily window', () => {
      expect(
        isWithinBusinessHours(new Date('2026-01-05T18:00:00Z'), NINE_TO_FIVE_UTC_WEEKDAYS)
      ).toBe(false)
    })

    it('false on a holiday', () => {
      const hours: BusinessHoursLike = {
        ...NINE_TO_FIVE_UTC_WEEKDAYS,
        holidays: [{ date: '2026-01-05' }],
      }
      expect(isWithinBusinessHours(new Date('2026-01-05T12:00:00Z'), hours)).toBe(false)
    })
  })

  describe('validators', () => {
    it('isValidTimezone accepts known IANA names', () => {
      expect(isValidTimezone('UTC')).toBe(true)
      expect(isValidTimezone('America/New_York')).toBe(true)
    })

    it('isValidTimezone rejects garbage', () => {
      expect(isValidTimezone('Not/A/Real/Zone')).toBe(false)
    })

    it('validateRange rejects start >= end', () => {
      expect(() => validateRange({ start: '17:00', end: '09:00' })).toThrow()
      expect(() => validateRange({ start: '09:00', end: '09:00' })).toThrow()
    })

    it('validateRange rejects malformed HH:MM values', () => {
      expect(() => validateRange({ start: '9:00', end: '17:00' })).toThrow()
      expect(() => validateRange({ start: '09:00', end: '24:00' })).toThrow()
    })

    it('validateSchedule rejects overlapping ranges', () => {
      expect(() =>
        validateSchedule({
          mon: [
            { start: '09:00', end: '12:00' },
            { start: '11:00', end: '14:00' },
          ],
          tue: [],
          wed: [],
          thu: [],
          fri: [],
          sat: [],
          sun: [],
        })
      ).toThrow()
    })

    it('validateSchedule accepts non-overlapping ranges', () => {
      expect(() =>
        validateSchedule({
          mon: [
            { start: '09:00', end: '12:00' },
            { start: '13:00', end: '17:00' },
          ],
          tue: [],
          wed: [],
          thu: [],
          fri: [],
          sat: [],
          sun: [],
        })
      ).not.toThrow()
    })

    it('validateSchedule tolerates missing day arrays as closed days', () => {
      expect(() =>
        validateSchedule({
          mon: [{ start: '09:00', end: '17:00' }],
        } as unknown as BusinessHoursLike['schedule'])
      ).not.toThrow()
    })

    it('validateHolidays rejects malformed dates', () => {
      expect(() => validateHolidays([{ date: '2026-13-40' }])).toThrow()
      expect(() => validateHolidays([{ date: 'not-a-date' }])).toThrow()
    })

    it('validateHolidays accepts ISO dates', () => {
      expect(() => validateHolidays([{ date: '2026-01-01', label: 'NYD' }])).not.toThrow()
    })
  })
})
