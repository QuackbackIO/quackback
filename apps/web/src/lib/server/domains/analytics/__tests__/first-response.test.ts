import { describe, it, expect } from 'vitest'
import { buildFirstResponseTimes } from '../first-response'

describe('buildFirstResponseTimes', () => {
  it('buckets conversations per UTC arrival day with the median minutes-to-first-response', () => {
    const r = buildFirstResponseTimes(
      [
        // Day 1: 30m and 90m → median 60
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-01T09:30:00Z' },
        { createdAt: '2026-07-01T10:00:00Z', firstResponseAt: '2026-07-01T11:30:00Z' },
        // Day 3: single conversation, 5m
        { createdAt: '2026-07-03T12:00:00Z', firstResponseAt: '2026-07-03T12:05:00Z' },
      ],
      '2026-07-01',
      '2026-07-03'
    )
    expect(r.days).toEqual([
      { date: '2026-07-01', medianMinutes: 60 },
      { date: '2026-07-02', medianMinutes: null },
      { date: '2026-07-03', medianMinutes: 5 },
    ])
    // Period median of [30, 90, 5] → 30
    expect(r.medianMinutes).toBe(30)
    expect(r.responded).toBe(3)
  })

  it('averages the two middle values for an even sample, mirroring percentile_cont', () => {
    const r = buildFirstResponseTimes(
      [
        { createdAt: '2026-07-01T00:00:00Z', firstResponseAt: '2026-07-01T00:10:00Z' },
        { createdAt: '2026-07-01T01:00:00Z', firstResponseAt: '2026-07-01T01:20:00Z' },
      ],
      '2026-07-01',
      '2026-07-01'
    )
    expect(r.days[0].medianMinutes).toBe(15)
    expect(r.medianMinutes).toBe(15)
  })

  it('null-fills days without a responded conversation instead of dropping them', () => {
    const r = buildFirstResponseTimes(
      [{ createdAt: '2026-07-03T09:00:00Z', firstResponseAt: '2026-07-03T09:12:00Z' }],
      '2026-07-01',
      '2026-07-04'
    )
    expect(r.days.map((d) => d.date)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
    ])
    expect(r.days[0]).toEqual({ date: '2026-07-01', medianMinutes: null })
  })

  it('returns a null median when nothing in the period got a response', () => {
    const r = buildFirstResponseTimes([], '2026-07-01', '2026-07-03')
    expect(r.medianMinutes).toBeNull()
    expect(r.responded).toBe(0)
    expect(r.days).toHaveLength(3)
    expect(r.days[0]).toEqual({ date: '2026-07-01', medianMinutes: null })
  })

  it('accepts Date rows, ignores rows outside the range, and keeps responses past midnight', () => {
    const r = buildFirstResponseTimes(
      [
        // Arrived late evening, answered the next morning: 10h, still bucketed
        // on the arrival day.
        { createdAt: new Date('2026-07-02T22:00:00Z'), firstResponseAt: '2026-07-03T08:00:00Z' },
        { createdAt: new Date('2026-06-30T10:00:00Z'), firstResponseAt: '2026-06-30T10:05:00Z' },
      ],
      '2026-07-01',
      '2026-07-02'
    )
    expect(r.responded).toBe(1)
    expect(r.days[1]).toEqual({ date: '2026-07-02', medianMinutes: 600 })
  })
})
