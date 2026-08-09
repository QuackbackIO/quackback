/**
 * The cron evaluator.
 *
 * Every assertion here is about a schedule that a sweep actually runs on, and
 * the negative cases exist because the failure mode of a cron parser is silence:
 * a mis-read expression changes a sweep's cadence with nothing in the logs. So
 * the parser is required to throw on anything it does not fully support, and
 * that requirement is tested as hard as the happy path.
 */
import { describe, expect, it } from 'vitest'
import { latestSlotAtOrBefore, matchesCron, nextSlotAfter, parseCron, slotKey } from '../cron'

/** Local time, because the schedules are local time — see cron.ts. */
function at(y: number, mo: number, d: number, h: number, mi: number, s = 0): Date {
  return new Date(y, mo - 1, d, h, mi, s)
}

describe('parseCron', () => {
  it('expands a wildcard field to its whole range', () => {
    const cron = parseCron('* * * * *')
    expect(cron.fields[0].size).toBe(60)
    expect(cron.fields[1].size).toBe(24)
  })

  it('expands a step over a wildcard', () => {
    const cron = parseCron('*/5 * * * *')
    expect([...cron.fields[0]].sort((a, b) => a - b)).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ])
  })

  it('expands a range and a list', () => {
    expect([...parseCron('1-4 * * * *').fields[0]].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect([...parseCron('0,30 * * * *').fields[0]].sort((a, b) => a - b)).toEqual([0, 30])
  })

  it('reads a bare number with a step as "from here to the end of the range"', () => {
    expect([...parseCron('5/20 * * * *').fields[0]].sort((a, b) => a - b)).toEqual([5, 25, 45])
  })

  // The whole reason this parser is strict. Each of these has a plausible
  // "helpful" reading, and every one of them would change a sweep's cadence
  // without an error anywhere.
  it.each([
    ['too few fields', '* * * *'],
    ['too many fields', '* * * * * *'],
    ['non-standard @daily', '@daily'],
    ['a name instead of a number', '0 0 * * MON'],
    ['the L modifier', '0 0 L * *'],
    ['the ? placeholder', '0 0 ? * *'],
    ['a hash step', '0 0 * * 1#2'],
    ['minute out of range', '60 * * * *'],
    ['hour out of range', '* 24 * * *'],
    ['day-of-week out of range', '* * * * 7'],
    ['an inverted range', '30-10 * * * *'],
    ['a zero step', '*/0 * * * *'],
    ['an empty term', '0,,5 * * * *'],
  ])('throws on %s', (_label, pattern) => {
    expect(() => parseCron(pattern)).toThrow()
  })
})

describe('matchesCron', () => {
  it('matches the daily 03:00 slot and nothing adjacent', () => {
    const cron = parseCron('0 3 * * *')
    expect(matchesCron(cron, at(2026, 8, 9, 3, 0))).toBe(true)
    expect(matchesCron(cron, at(2026, 8, 9, 3, 1))).toBe(false)
    expect(matchesCron(cron, at(2026, 8, 9, 4, 0))).toBe(false)
  })

  it('ORs day-of-month with day-of-week when both are restricted', () => {
    // Cron's traditional rule: `0 0 13 * 5` fires on the 13th AND on Fridays.
    const cron = parseCron('0 0 13 * 5')
    expect(matchesCron(cron, at(2026, 8, 13, 0, 0))).toBe(true) // the 13th (a Thursday)
    expect(matchesCron(cron, at(2026, 8, 14, 0, 0))).toBe(true) // a Friday
    expect(matchesCron(cron, at(2026, 8, 15, 0, 0))).toBe(false) // neither
  })

  it('ANDs nothing when only one of the day fields is restricted', () => {
    const dom = parseCron('0 0 13 * *')
    expect(matchesCron(dom, at(2026, 8, 13, 0, 0))).toBe(true)
    expect(matchesCron(dom, at(2026, 8, 14, 0, 0))).toBe(false)
  })
})

describe('slot search', () => {
  it('finds the current slot at or before now, not the next one', () => {
    const cron = parseCron('0 * * * *')
    const slot = latestSlotAtOrBefore(cron, at(2026, 8, 9, 14, 37, 12))
    expect(slot).toEqual(at(2026, 8, 9, 14, 0))
  })

  it('returns the instant itself when now IS a slot', () => {
    const cron = parseCron('*/5 * * * *')
    expect(latestSlotAtOrBefore(cron, at(2026, 8, 9, 14, 35, 40))).toEqual(at(2026, 8, 9, 14, 35))
  })

  it('finds the next slot strictly after now', () => {
    const cron = parseCron('*/5 * * * *')
    // Exactly on a slot: the NEXT one, not this one — otherwise a scheduler
    // sitting on a slot boundary would set a zero-length timer and spin.
    expect(nextSlotAfter(cron, at(2026, 8, 9, 14, 35, 0))).toEqual(at(2026, 8, 9, 14, 40))
  })

  it('crosses a day boundary backwards for a daily schedule', () => {
    const cron = parseCron('0 3 * * *')
    expect(latestSlotAtOrBefore(cron, at(2026, 8, 9, 1, 0))).toEqual(at(2026, 8, 8, 3, 0))
  })

  it('emits one slot per minute for the minutely sweeps', () => {
    const cron = parseCron('* * * * *')
    expect(latestSlotAtOrBefore(cron, at(2026, 8, 9, 14, 37, 59))).toEqual(at(2026, 8, 9, 14, 37))
    expect(nextSlotAfter(cron, at(2026, 8, 9, 14, 37, 59))).toEqual(at(2026, 8, 9, 14, 38))
  })
})

describe('slotKey', () => {
  it('is stable for one slot and distinct across slots', () => {
    const a = slotKey('analytics', at(2026, 8, 9, 14, 0))
    // The INSTANT, not the wall clock — see cron.ts. `__tests__/cron-dst.test.ts`
    // holds the transition-day cases this format exists for.
    expect(a).toBe(`analytics:${at(2026, 8, 9, 14, 0).toISOString()}`)
    expect(slotKey('analytics', at(2026, 8, 9, 14, 0))).toBe(a)
    expect(slotKey('analytics', at(2026, 8, 9, 15, 0))).not.toBe(a)
    expect(slotKey('anon-sweep', at(2026, 8, 9, 14, 0))).not.toBe(a)
  })

  it('separates two instants that share a wall clock', () => {
    // The fall-back property, stated here too because this is where a future
    // reader will be tempted to "simplify" the key back to local time.
    const a = new Date('2026-11-01T05:30:00Z')
    const b = new Date('2026-11-01T06:30:00Z')
    expect(slotKey('probe', a)).not.toBe(slotKey('probe', b))
  })
})
