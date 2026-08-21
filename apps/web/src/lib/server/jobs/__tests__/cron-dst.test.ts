/**
 * Daylight-saving transitions.
 *
 * A separate file because it pins the process timezone: these are the two days a
 * year when local wall-clock time is not a function of elapsed time, and both
 * failure modes were real.
 *
 * Driven tick by tick through the same functions the scheduler uses, under
 * `America/New_York`, which springs forward at 02:00 on 2026-03-08 (02:00–02:59
 * does not exist) and falls back at 02:00 on 2026-11-01 (01:00–01:59 happens
 * twice).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { latestSlotAtOrBefore, nextSlotAfter, parseCron, slotKey } from '../cron'

beforeAll(() => {
  // vitest runs each file in its own worker, so this does not leak.
  process.env.TZ = 'America/New_York'
})

/**
 * Every distinct slot a schedule produces on one LOCAL calendar day, found the
 * way the scheduler finds them — by asking `latestSlotAtOrBefore` once a minute
 * and recording each new answer.
 *
 * Counting per calendar day is what makes the assertion unambiguous: a
 * spring-forward day is 23 real hours and a fall-back day is 25, so an hourly
 * schedule must produce exactly 23 and 25 slots on them. A window with
 * arbitrary bounds cannot say that.
 */
function slotsOnLocalDay(pattern: string, localDay: string): string[] {
  const cron = parseCron(pattern)
  // Start well before the day and run well past it, then keep only the slots
  // whose local date is the day under test.
  const start = new Date(`${localDay}T00:00:00Z`).getTime() - 12 * 3_600_000
  const keys: string[] = []
  const seenMs = new Set<number>()
  for (let m = 0; m <= 48 * 60; m++) {
    const slot = latestSlotAtOrBefore(cron, new Date(start + m * 60_000))
    if (!slot || seenMs.has(slot.getTime())) continue
    seenMs.add(slot.getTime())
    const y = slot.getFullYear()
    const mo = String(slot.getMonth() + 1).padStart(2, '0')
    const d = String(slot.getDate()).padStart(2, '0')
    if (`${y}-${mo}-${d}` === localDay) keys.push(slotKey('probe', slot))
  }
  return keys
}

describe('spring forward — the hour that does not exist', () => {
  it('finds a slot on the transition day for a schedule inside the gap', () => {
    // 02:30 is `page-view-partitions`. On 2026-03-08 that wall-clock time never
    // occurs. The walk must still resolve — before this was fixed it stepped on
    // wall-clock fields, which normalises 02:59 FORWARD to 03:59 and livelocks
    // inside the gap until the search budget runs out, returning null.
    const cron = parseCron('30 2 * * *')
    const middayOfTransitionDay = new Date('2026-03-08T16:00:00Z') // 11:00 EST->EDT day
    const slot = latestSlotAtOrBefore(cron, middayOfTransitionDay)
    expect(slot).not.toBeNull()
    // The most recent 02:30 that actually happened is the previous day's.
    expect(slot!.toISOString()).toBe('2026-03-07T07:30:00.000Z')
  })

  it('never returns null across the whole transition day, for either schedule', () => {
    for (const pattern of ['30 2 * * *', '0 3 * * *', '*/5 * * * *', '0 * * * *']) {
      const cron = parseCron(pattern)
      for (let m = 0; m < 24 * 60; m++) {
        const at = new Date(new Date('2026-03-08T05:00:00Z').getTime() + m * 60_000)
        expect(latestSlotAtOrBefore(cron, at), `${pattern} at ${at.toISOString()}`).not.toBeNull()
        expect(nextSlotAfter(cron, at), `${pattern} next at ${at.toISOString()}`).not.toBeNull()
      }
    }
  })

  it('delivers 23 hourly slots on the 23-hour day, each one distinct', () => {
    const slots = slotsOnLocalDay('0 * * * *', '2026-03-08')
    expect(new Set(slots).size).toBe(slots.length)
    expect(slots.length).toBe(23)
    // A normal day either side, as the control that 23 is the transition and
    // not a counting error.
    expect(slotsOnLocalDay('0 * * * *', '2026-03-07').length).toBe(24)
    expect(slotsOnLocalDay('0 * * * *', '2026-03-09').length).toBe(24)
  })

  it('delivers 276 five-minutely slots on the 23-hour day', () => {
    expect(slotsOnLocalDay('*/5 * * * *', '2026-03-08').length).toBe(23 * 12)
    expect(slotsOnLocalDay('*/5 * * * *', '2026-03-07').length).toBe(24 * 12)
  })
})

describe('fall back — the hour that happens twice', () => {
  it('gives the repeated hour distinct keys instead of collapsing it', () => {
    // 01:30 EDT and 01:30 EST are different instants with the same wall clock. A
    // local-time key made them one string, so the unique index threw the second
    // pass away as a duplicate and the entire extra hour was suppressed.
    const first = new Date('2026-11-01T05:30:00Z') // 01:30 EDT
    const second = new Date('2026-11-01T06:30:00Z') // 01:30 EST
    expect(first.getHours()).toBe(second.getHours())
    expect(first.getMinutes()).toBe(second.getMinutes())
    expect(slotKey('probe', first)).not.toBe(slotKey('probe', second))
  })

  it('delivers 25 hourly slots on the 25-hour day, each one distinct', () => {
    // Measured before the fix: the repeated hour collapsed onto one key and was
    // thrown away as a duplicate, so an hourly schedule lost an hour outright.
    const slots = slotsOnLocalDay('0 * * * *', '2026-11-01')
    expect(new Set(slots).size).toBe(slots.length)
    expect(slots.length).toBe(25)
    expect(slotsOnLocalDay('0 * * * *', '2026-10-31').length).toBe(24)
  })

  it('delivers 300 five-minutely slots on the 25-hour day', () => {
    // 48 where 60 were due, before this changed.
    const slots = slotsOnLocalDay('*/5 * * * *', '2026-11-01')
    expect(new Set(slots).size).toBe(slots.length)
    expect(slots.length).toBe(25 * 12)
  })
})
