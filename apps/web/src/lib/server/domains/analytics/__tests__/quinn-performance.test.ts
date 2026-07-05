import { describe, it, expect } from 'vitest'
import { summarizeQuinnPerformance } from '../quinn-performance'

describe('summarizeQuinnPerformance', () => {
  it('returns a zeroed summary for no involvements (rates are 0, not NaN)', () => {
    expect(summarizeQuinnPerformance([], 0, 0)).toEqual({
      involvements: 0,
      conversations: 0,
      involvementRate: 0,
      resolvedConfirmed: 0,
      resolvedAssumed: 0,
      resolutionRate: 0,
      handedOff: 0,
      escalationRate: 0,
      actionsTaken: 0,
      dailyTrend: [],
    })
  })

  it('computes the resolution rate as (confirmed + assumed) / involvements', () => {
    const rows = [
      { status: 'resolved_confirmed' as const, createdAt: '2026-06-01T10:00:00Z' },
      { status: 'resolved_assumed' as const, createdAt: '2026-06-01T11:00:00Z' },
      { status: 'active' as const, createdAt: '2026-06-01T12:00:00Z' },
      { status: 'handed_off' as const, createdAt: '2026-06-01T13:00:00Z' },
    ]
    const s = summarizeQuinnPerformance(rows, 4, 0)
    expect(s.involvements).toBe(4)
    expect(s.resolvedConfirmed).toBe(1)
    expect(s.resolvedAssumed).toBe(1)
    expect(s.resolutionRate).toBe(50) // 2 of 4
    expect(s.handedOff).toBe(1)
    expect(s.escalationRate).toBe(25) // 1 of 4
  })

  it('computes the involvement rate against total conversations in range', () => {
    const rows = Array.from({ length: 4 }, () => ({
      status: 'active' as const,
      createdAt: '2026-06-01T10:00:00Z',
    }))
    const s = summarizeQuinnPerformance(rows, 10, 0)
    expect(s.involvementRate).toBe(40) // 4 of 10
  })

  it('reports a 0 involvement rate (not NaN) when there were no conversations', () => {
    const s = summarizeQuinnPerformance([], 0, 3)
    expect(s.involvementRate).toBe(0)
    expect(s.actionsTaken).toBe(3)
  })

  it('passes actionsTaken through unchanged', () => {
    const s = summarizeQuinnPerformance([], 5, 12)
    expect(s.actionsTaken).toBe(12)
  })

  it('ignores abandoned involvements in the resolution/escalation numerators', () => {
    const rows = [
      { status: 'abandoned' as const, createdAt: '2026-06-01T10:00:00Z' },
      { status: 'resolved_confirmed' as const, createdAt: '2026-06-01T11:00:00Z' },
    ]
    const s = summarizeQuinnPerformance(rows, 2, 0)
    expect(s.resolvedConfirmed).toBe(1)
    expect(s.resolutionRate).toBe(50)
    expect(s.handedOff).toBe(0)
    expect(s.escalationRate).toBe(0)
  })

  it('groups the daily trend by UTC date, ascending, with per-day involvements + resolved', () => {
    const rows = [
      { status: 'active' as const, createdAt: '2026-06-02T09:00:00Z' },
      { status: 'resolved_confirmed' as const, createdAt: '2026-06-01T10:00:00Z' },
      { status: 'handed_off' as const, createdAt: '2026-06-01T23:30:00Z' },
    ]
    const s = summarizeQuinnPerformance(rows, 3, 0)
    expect(s.dailyTrend).toEqual([
      { date: '2026-06-01', involvements: 2, resolved: 1 },
      { date: '2026-06-02', involvements: 1, resolved: 0 },
    ])
  })

  it('accepts Date objects as well as ISO strings for createdAt', () => {
    const s = summarizeQuinnPerformance(
      [{ status: 'active' as const, createdAt: new Date('2026-06-03T12:00:00Z') }],
      1,
      0
    )
    expect(s.dailyTrend).toEqual([{ date: '2026-06-03', involvements: 1, resolved: 0 }])
  })
})
