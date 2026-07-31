import { describe, it, expect } from 'vitest'
import { buildTimeToClose } from '../time-to-close'

describe('buildTimeToClose', () => {
  it('buckets conversations per UTC close day with the median minutes-to-close', () => {
    const r = buildTimeToClose(
      [
        // Closed day 1: 60m and 180m → median 120
        { createdAt: '2026-07-01T09:00:00Z', closedAt: '2026-07-01T10:00:00Z' },
        { createdAt: '2026-07-01T08:00:00Z', closedAt: '2026-07-01T11:00:00Z' },
        // Closed day 3: single conversation, 45m
        { createdAt: '2026-07-03T12:00:00Z', closedAt: '2026-07-03T12:45:00Z' },
      ],
      '2026-07-01',
      '2026-07-03'
    )
    expect(r.days).toEqual([
      { date: '2026-07-01', medianMinutes: 120 },
      { date: '2026-07-02', medianMinutes: null },
      { date: '2026-07-03', medianMinutes: 45 },
    ])
    // Period median of [60, 180, 45] → 60
    expect(r.medianMinutes).toBe(60)
    expect(r.closed).toBe(3)
  })

  it('averages the two middle values for an even sample, mirroring percentile_cont', () => {
    const r = buildTimeToClose(
      [
        { createdAt: '2026-07-01T00:00:00Z', closedAt: '2026-07-01T01:00:00Z' },
        { createdAt: '2026-07-01T00:00:00Z', closedAt: '2026-07-01T03:00:00Z' },
      ],
      '2026-07-01',
      '2026-07-01'
    )
    expect(r.days[0].medianMinutes).toBe(120)
    expect(r.medianMinutes).toBe(120)
  })

  it('null-fills days without a closed conversation instead of dropping them', () => {
    const r = buildTimeToClose(
      [{ createdAt: '2026-07-02T09:00:00Z', closedAt: '2026-07-03T09:30:00Z' }],
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
    expect(r.days[2]).toEqual({ date: '2026-07-03', medianMinutes: 1470 })
  })

  it('returns a null median when nothing closed in the period', () => {
    const r = buildTimeToClose([], '2026-07-01', '2026-07-03')
    expect(r.medianMinutes).toBeNull()
    expect(r.closed).toBe(0)
    expect(r.days).toHaveLength(3)
    expect(r.days[0]).toEqual({ date: '2026-07-01', medianMinutes: null })
  })

  it('buckets a multi-day resolution on the close day, not the arrival day', () => {
    const r = buildTimeToClose(
      [
        // Arrived before the window, closed inside it: the close day is what
        // the chart reads.
        { createdAt: new Date('2026-06-28T10:00:00Z'), closedAt: '2026-07-02T12:00:00Z' },
        { createdAt: new Date('2026-07-05T10:00:00Z'), closedAt: '2026-07-05T11:00:00Z' },
      ],
      '2026-07-01',
      '2026-07-03'
    )
    expect(r.closed).toBe(1)
    expect(r.days[1].date).toBe('2026-07-02')
    expect(r.days[1].medianMinutes).toBe(4 * 1440 + 120)
  })
})
