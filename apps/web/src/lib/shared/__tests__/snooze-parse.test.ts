/**
 * Deterministic natural-language snooze parsing. Fixed `now` anchors every
 * case so the rules (not the clock) are what is tested. Pure unit test.
 */
import { describe, it, expect } from 'vitest'
import { parseSnoozeTime } from '../snooze-parse'

// Wednesday 2026-07-29, 10:30 local.
const NOW = new Date(2026, 6, 29, 10, 30, 0, 0)
const at = (d: Date | null) => d?.getTime()
const local = (y: number, m: number, day: number, h: number, min = 0) =>
  new Date(y, m, day, h, min, 0, 0).getTime()

describe('parseSnoozeTime', () => {
  it('parses relative offsets', () => {
    expect(at(parseSnoozeTime('in 2 hours', { now: NOW }))).toBe(local(2026, 6, 29, 12, 30))
    expect(at(parseSnoozeTime('in 30 minutes', { now: NOW }))).toBe(local(2026, 6, 29, 11, 0))
    expect(at(parseSnoozeTime('in 3 days', { now: NOW }))).toBe(local(2026, 7, 1, 10, 30))
    expect(at(parseSnoozeTime('in 1 week', { now: NOW }))).toBe(local(2026, 7, 5, 10, 30))
  })

  it('parses tomorrow with day-part defaults', () => {
    expect(at(parseSnoozeTime('tomorrow', { now: NOW }))).toBe(local(2026, 6, 30, 9))
    expect(at(parseSnoozeTime('tomorrow morning', { now: NOW }))).toBe(local(2026, 6, 30, 9))
    expect(at(parseSnoozeTime('tomorrow afternoon', { now: NOW }))).toBe(local(2026, 6, 30, 14))
    expect(at(parseSnoozeTime('tomorrow evening', { now: NOW }))).toBe(local(2026, 6, 30, 18))
  })

  it('parses explicit clock times', () => {
    expect(at(parseSnoozeTime('tomorrow at 3pm', { now: NOW }))).toBe(local(2026, 6, 30, 15))
    expect(at(parseSnoozeTime('tomorrow at 9:30', { now: NOW }))).toBe(local(2026, 6, 30, 9, 30))
    // "at 3pm" today is still ahead at 10:30.
    expect(at(parseSnoozeTime('at 3pm', { now: NOW }))).toBe(local(2026, 6, 29, 15))
    // "at 9am" today has passed — roll to tomorrow.
    expect(at(parseSnoozeTime('at 9am', { now: NOW }))).toBe(local(2026, 6, 30, 9))
  })

  it('parses weekdays, never landing in the past', () => {
    // Friday is two days out.
    expect(at(parseSnoozeTime('friday', { now: NOW }))).toBe(local(2026, 6, 31, 9))
    expect(at(parseSnoozeTime('next friday', { now: NOW }))).toBe(local(2026, 6, 31, 9))
    // Today is Wednesday and 9:00 has passed — the coming Wednesday is next week.
    expect(at(parseSnoozeTime('wednesday', { now: NOW }))).toBe(local(2026, 7, 5, 9))
    // A weekday still ahead today lands today.
    const early = new Date(2026, 6, 29, 8, 0, 0, 0)
    expect(at(parseSnoozeTime('wednesday', { now: early }))).toBe(local(2026, 6, 29, 9))
    // Day parts compose with weekdays.
    expect(at(parseSnoozeTime('friday afternoon', { now: NOW }))).toBe(local(2026, 6, 31, 14))
  })

  it('parses the preset-shaped phrases', () => {
    expect(at(parseSnoozeTime('later today', { now: NOW }))).toBe(local(2026, 6, 29, 14, 30))
    expect(at(parseSnoozeTime('next week', { now: NOW }))).toBe(local(2026, 7, 3, 9))
    expect(at(parseSnoozeTime('next month', { now: NOW }))).toBe(local(2026, 7, 1, 9))
  })

  it('rolls a past day-part to tomorrow', () => {
    expect(at(parseSnoozeTime('morning', { now: NOW }))).toBe(local(2026, 6, 30, 9))
    const evening = new Date(2026, 6, 29, 19, 0, 0, 0)
    expect(at(parseSnoozeTime('tonight', { now: evening }))).toBe(local(2026, 6, 30, 18))
    expect(at(parseSnoozeTime('tonight', { now: NOW }))).toBe(local(2026, 6, 29, 18))
  })

  it('resolves localized weekday names via the given locale', () => {
    // French "lundi" — Monday. From Wednesday the coming Monday is Aug 3.
    expect(at(parseSnoozeTime('lundi', { now: NOW, locale: 'fr' }))).toBe(local(2026, 7, 3, 9))
    // English still works alongside the locale.
    expect(at(parseSnoozeTime('monday', { now: NOW, locale: 'fr' }))).toBe(local(2026, 7, 3, 9))
  })

  it('returns null for input it cannot place in the future', () => {
    expect(parseSnoozeTime('', { now: NOW })).toBeNull()
    expect(parseSnoozeTime('whenever', { now: NOW })).toBeNull()
    expect(parseSnoozeTime('in 0 minutes', { now: NOW })).toBeNull()
    expect(parseSnoozeTime('tomorrow at 25:00', { now: NOW })).toBeNull()
  })
})
