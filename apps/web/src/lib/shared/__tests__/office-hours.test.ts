import { describe, expect, it } from 'vitest'
import {
  isWithinOfficeHours,
  nextOpenAt,
  isValidTimeZone,
  officeHoursScheduleFromLegacyDays,
  DEFAULT_OFFICE_HOURS_SCHEDULE,
  type OfficeHoursSchedule,
} from '../office-hours'

/** Mon–Fri 09:00–17:00, weekends closed, in the given timezone. */
function weekdays9to5(timezone: string, enabled = true): OfficeHoursSchedule {
  return {
    enabled,
    timezone,
    intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
  }
}

describe('isValidTimeZone', () => {
  it('accepts known IANA zones and rejects junk', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('Europe/London')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

// 2026-01-05 is a Monday; 2026-01-04 is a Sunday.
describe('isWithinOfficeHours', () => {
  it('treats a disabled schedule as 24/7 (always open)', () => {
    expect(
      isWithinOfficeHours(DEFAULT_OFFICE_HOURS_SCHEDULE, new Date('2026-01-04T03:00:00Z'))
    ).toBe(true)
    expect(isWithinOfficeHours(weekdays9to5('UTC', false), new Date('2026-01-04T03:00:00Z'))).toBe(
      true
    )
  })

  it('is closed when enabled with no intervals', () => {
    const empty: OfficeHoursSchedule = { enabled: true, timezone: 'UTC', intervals: [] }
    expect(isWithinOfficeHours(empty, new Date('2026-01-05T12:00:00Z'))).toBe(false)
  })

  it('is open midday on a weekday (UTC)', () => {
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-05T12:00:00Z'))).toBe(true)
  })

  it('is closed before opening and treats the close time as exclusive', () => {
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-05T08:59:00Z'))).toBe(false)
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-05T16:59:00Z'))).toBe(true)
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-05T17:00:00Z'))).toBe(false)
  })

  it('is closed on a day with no interval (Sunday)', () => {
    expect(isWithinOfficeHours(weekdays9to5('UTC'), new Date('2026-01-04T12:00:00Z'))).toBe(false)
  })

  it('evaluates the configured timezone, not UTC', () => {
    const ny = weekdays9to5('America/New_York')
    // Mon: 14:00Z = 09:00 EST → open; 13:59Z = 08:59 EST → closed.
    expect(isWithinOfficeHours(ny, new Date('2026-01-05T14:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(ny, new Date('2026-01-05T13:59:00Z'))).toBe(false)
  })

  it('supports overnight intervals (end < start) across the day boundary', () => {
    // Friday 22:00 → Saturday 06:00, in UTC.
    const overnight: OfficeHoursSchedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 5, start: '22:00', end: '06:00' }],
    }
    // 2026-01-09 is Friday, 2026-01-10 is Saturday.
    expect(isWithinOfficeHours(overnight, new Date('2026-01-09T23:00:00Z'))).toBe(true) // Fri eve
    expect(isWithinOfficeHours(overnight, new Date('2026-01-10T05:00:00Z'))).toBe(true) // Sat morning
    expect(isWithinOfficeHours(overnight, new Date('2026-01-10T06:00:00Z'))).toBe(false) // exclusive end
    expect(isWithinOfficeHours(overnight, new Date('2026-01-09T21:00:00Z'))).toBe(false) // before open
  })

  it('treats an end of 00:00 as midnight / end-of-day', () => {
    const tillMidnight: OfficeHoursSchedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 1, start: '09:00', end: '00:00' }],
    }
    expect(isWithinOfficeHours(tillMidnight, new Date('2026-01-05T23:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(tillMidnight, new Date('2026-01-05T08:00:00Z'))).toBe(false)
  })

  it('fails closed on an unknown timezone', () => {
    expect(isWithinOfficeHours(weekdays9to5('Not/AZone'), new Date('2026-01-05T12:00:00Z'))).toBe(
      false
    )
  })

  it('supports multiple intervals on the same day (split shift)', () => {
    const split: OfficeHoursSchedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [
        { day: 1, start: '09:00', end: '12:00' },
        { day: 1, start: '13:00', end: '17:00' },
      ],
    }
    expect(isWithinOfficeHours(split, new Date('2026-01-05T12:30:00Z'))).toBe(false) // lunch
    expect(isWithinOfficeHours(split, new Date('2026-01-05T10:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(split, new Date('2026-01-05T15:00:00Z'))).toBe(true)
  })

  it('is open during BST with the summer offset (Europe/London)', () => {
    const london = weekdays9to5('Europe/London')
    // 2026-07-06 Monday. 08:00Z = 09:00 BST → open; 07:59Z = 08:59 BST → closed.
    expect(isWithinOfficeHours(london, new Date('2026-07-06T08:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(london, new Date('2026-07-06T07:59:00Z'))).toBe(false)
    // Winter (GMT): 2026-01-05 Monday, 09:00Z = 09:00 GMT → open.
    expect(isWithinOfficeHours(london, new Date('2026-01-05T09:00:00Z'))).toBe(true)
  })

  it('is open during EDT with the summer offset (America/New_York)', () => {
    const ny = weekdays9to5('America/New_York')
    // 2026-06-01 Monday. 13:00Z = 09:00 EDT → open; 12:59Z = 08:59 EDT → closed.
    expect(isWithinOfficeHours(ny, new Date('2026-06-01T13:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(ny, new Date('2026-06-01T12:59:00Z'))).toBe(false)
  })
})

describe('nextOpenAt', () => {
  it('returns null for a disabled (24/7) schedule', () => {
    expect(nextOpenAt(weekdays9to5('UTC', false), new Date('2026-06-03T07:00:00Z'))).toBeNull()
  })

  it('returns null when there are no intervals', () => {
    const empty: OfficeHoursSchedule = { enabled: true, timezone: 'UTC', intervals: [] }
    expect(nextOpenAt(empty, new Date('2026-06-03T07:00:00Z'))).toBeNull()
  })

  it('returns today opening when before the start (UTC)', () => {
    // 2026-06-03 is a Wednesday.
    expect(nextOpenAt(weekdays9to5('UTC'), new Date('2026-06-03T07:00:00Z'))?.toISOString()).toBe(
      '2026-06-03T09:00:00.000Z'
    )
  })

  it('skips today once the window has begun → next weekday', () => {
    expect(nextOpenAt(weekdays9to5('UTC'), new Date('2026-06-03T12:00:00Z'))?.toISOString()).toBe(
      '2026-06-04T09:00:00.000Z'
    )
    expect(nextOpenAt(weekdays9to5('UTC'), new Date('2026-06-03T18:00:00Z'))?.toISOString()).toBe(
      '2026-06-04T09:00:00.000Z'
    )
  })

  it('wraps the closed weekend to Monday', () => {
    // 2026-06-05 is a Friday.
    expect(nextOpenAt(weekdays9to5('UTC'), new Date('2026-06-05T18:00:00Z'))?.toISOString()).toBe(
      '2026-06-08T09:00:00.000Z'
    )
  })

  it('rolls a single-day schedule to the same weekday next week once it has started', () => {
    const wedOnly: OfficeHoursSchedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 3, start: '09:00', end: '17:00' }],
    }
    expect(nextOpenAt(wedOnly, new Date('2026-06-03T18:00:00Z'))?.toISOString()).toBe(
      '2026-06-10T09:00:00.000Z'
    )
  })

  it('returns null for an unknown timezone', () => {
    expect(nextOpenAt(weekdays9to5('Not/AZone'), new Date('2026-06-03T07:00:00Z'))).toBeNull()
  })
})

// DST transition dates, where the plain "wall time -> UTC" answer moves by an
// hour across the change. 2026 US spring-forward: Mar 8; fall-back: Nov 1.
// 2026 UK BST start: Mar 29.
describe('nextOpenAt — DST transitions', () => {
  it('resolves the London opening after BST begins (2026-03-29)', () => {
    // From Sunday 2026-03-29 (already on BST, UTC+1) → Monday 2026-03-30 09:00
    // BST = 08:00Z. A GMT (UTC+0) reading would wrongly give 09:00Z.
    const at = nextOpenAt(weekdays9to5('Europe/London'), new Date('2026-03-29T12:00:00Z'))
    expect(at?.toISOString()).toBe('2026-03-30T08:00:00.000Z')
  })

  it('resolves the New York opening after EDT begins (spring forward 2026-03-08)', () => {
    // Sunday 2026-03-08 (now EDT, UTC-4) → Monday 2026-03-09 09:00 EDT = 13:00Z.
    const at = nextOpenAt(weekdays9to5('America/New_York'), new Date('2026-03-08T12:00:00Z'))
    expect(at?.toISOString()).toBe('2026-03-09T13:00:00.000Z')
  })

  it('resolves the New York opening after EST returns (fall back 2026-11-01)', () => {
    // Sunday 2026-11-01 (now EST, UTC-5) → Monday 2026-11-02 09:00 EST = 14:00Z.
    const at = nextOpenAt(weekdays9to5('America/New_York'), new Date('2026-11-01T12:00:00Z'))
    expect(at?.toISOString()).toBe('2026-11-02T14:00:00.000Z')
  })

  it('skips a nonexistent opening forward through the spring-forward gap', () => {
    // NY "spring forward" 2026-03-08: 02:00 EST jumps to 03:00 EDT, so 02:30
    // never occurs. An opening declared at 02:30 that Sunday skips forward to
    // 03:30 EDT (07:30Z) rather than falling back before the gap.
    const gapStart: OfficeHoursSchedule = {
      enabled: true,
      timezone: 'America/New_York',
      intervals: [{ day: 0, start: '02:30', end: '05:00' }],
    }
    const at = nextOpenAt(gapStart, new Date('2026-03-08T05:00:00Z'))
    expect(at?.toISOString()).toBe('2026-03-08T07:30:00.000Z')
  })
})

// The legacy widgetConfig.messenger.officeHours shape (days[7], index 0 = Sunday)
// is converted to intervals for the read-time fallback; the mapper must preserve
// the legacy evaluator's exact semantics so upgraders' hours don't shift.
describe('officeHoursScheduleFromLegacyDays', () => {
  /** Mon–Fri 09:00–17:00 legacy config in the given timezone. */
  function legacyWeekdays9to5(timezone: string, enabled = true) {
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

  it('maps enabled weekdays to intervals and drops the disabled days', () => {
    const schedule = officeHoursScheduleFromLegacyDays(legacyWeekdays9to5('America/New_York'))
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

  it('carries the disabled (24/7) flag through', () => {
    const schedule = officeHoursScheduleFromLegacyDays(legacyWeekdays9to5('UTC', false))
    expect(schedule.enabled).toBe(false)
  })

  it('preserves an end of 00:00 as midnight / end-of-day', () => {
    // Monday 09:00 → 00:00 (midnight) is the legacy way to say "open until
    // end of day"; the converted interval must read open at 23:00 and closed
    // before opening, with no early-morning spill onto Sunday.
    const schedule = officeHoursScheduleFromLegacyDays({
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        enabled: d === 1,
        start: '09:00',
        end: '00:00',
      })),
    })
    expect(schedule.intervals).toEqual([{ day: 1, start: '09:00', end: '00:00' }])
    // 2026-01-05 is a Monday, 2026-01-04 a Sunday.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T23:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T08:00:00Z'))).toBe(false)
    // No spill into Sunday's early morning.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-04T02:00:00Z'))).toBe(false)
  })

  it('drops an inverted range instead of turning it into an overnight window', () => {
    // Legacy treated end <= start as closed (no overnight support); the mapper
    // must not resurrect it as a 17:00 → 09:00 overnight interval.
    const schedule = officeHoursScheduleFromLegacyDays({
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        enabled: d === 1,
        start: '17:00',
        end: '09:00',
      })),
    })
    expect(schedule.intervals).toEqual([])
  })

  it('drops malformed times', () => {
    const schedule = officeHoursScheduleFromLegacyDays({
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        enabled: d === 1,
        start: 'oops',
        end: '17:00',
      })),
    })
    expect(schedule.intervals).toEqual([])
  })

  it('drops a full day (00:00–00:00) it cannot represent as one interval', () => {
    const schedule = officeHoursScheduleFromLegacyDays({
      enabled: true,
      timezone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        enabled: d === 1,
        start: '00:00',
        end: '00:00',
      })),
    })
    expect(schedule.intervals).toEqual([])
  })

  it('defaults timezone and tolerates a missing days array', () => {
    const schedule = officeHoursScheduleFromLegacyDays({ enabled: true })
    expect(schedule).toEqual({ enabled: true, timezone: 'UTC', intervals: [], holidays: [] })
  })

  it('produces a schedule the resolver evaluates like the legacy config', () => {
    const schedule = officeHoursScheduleFromLegacyDays(legacyWeekdays9to5('UTC'))
    // Monday midday open, Sunday closed, close time exclusive.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T12:00:00Z'))).toBe(true)
    expect(isWithinOfficeHours(schedule, new Date('2026-01-04T12:00:00Z'))).toBe(false)
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T17:00:00Z'))).toBe(false)
  })
})

// Holidays close the whole schedule-local date, whatever the weekly windows
// say; a recurringAnnual entry matches its month-day every year.
describe('holidays', () => {
  it('is closed on a holiday that falls inside a weekly window', () => {
    const schedule = { ...weekdays9to5('UTC'), holidays: [{ date: '2026-01-05' }] }
    // 2026-01-05 is a Monday — inside a window, but closed all day.
    expect(isWithinOfficeHours(schedule, new Date('2026-01-05T12:00:00Z'))).toBe(false)
    expect(isWithinOfficeHours(schedule, new Date('2026-01-06T12:00:00Z'))).toBe(true)
  })

  it('matches a recurringAnnual holiday by month-day in later years', () => {
    const recurring = {
      ...weekdays9to5('UTC'),
      holidays: [{ date: '2026-01-05', recurringAnnual: true }],
    }
    // 2027-01-05 (a Tuesday) shares the 01-05 month-day → closed too.
    expect(isWithinOfficeHours(recurring, new Date('2027-01-05T12:00:00Z'))).toBe(false)
    // A non-recurring entry stays pinned to its exact date.
    const once = { ...weekdays9to5('UTC'), holidays: [{ date: '2026-01-05' }] }
    expect(isWithinOfficeHours(once, new Date('2027-01-05T12:00:00Z'))).toBe(true)
  })

  it('evaluates the holiday on the schedule-local date, not the UTC date', () => {
    // Tokyo is UTC+9: 16:00Z on the 5th is already 01:00 JST on the 6th.
    const tokyo: OfficeHoursSchedule = {
      enabled: true,
      timezone: 'Asia/Tokyo',
      intervals: [1, 2, 3].map((day) => ({ day, start: '00:00', end: '23:59' })),
      holidays: [{ date: '2026-01-06' }], // the Tuesday
    }
    // Mon 23:00 JST (14:00Z on the 5th): open.
    expect(isWithinOfficeHours(tokyo, new Date('2026-01-05T14:00:00Z'))).toBe(true)
    // Tue 01:00 JST (16:00Z on the 5th): the holiday's local date — closed.
    expect(isWithinOfficeHours(tokyo, new Date('2026-01-05T16:00:00Z'))).toBe(false)
    // Wed 01:00 JST (16:00Z on the 6th): open again.
    expect(isWithinOfficeHours(tokyo, new Date('2026-01-06T16:00:00Z'))).toBe(true)
  })

  it('nextOpenAt skips a holiday instead of pointing at its window', () => {
    const schedule = { ...weekdays9to5('UTC'), holidays: [{ date: '2026-06-03' }] }
    // Wednesday 2026-06-03 is a holiday: ahead of its window, the next opening
    // is Thursday's.
    expect(nextOpenAt(schedule, new Date('2026-06-03T07:00:00Z'))?.toISOString()).toBe(
      '2026-06-04T09:00:00.000Z'
    )
  })
})
