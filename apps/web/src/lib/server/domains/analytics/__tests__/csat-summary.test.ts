import { describe, it, expect } from 'vitest'
import { summarizeCsat } from '../csat-summary'

describe('summarizeCsat', () => {
  it('returns a zeroed summary for no responses', () => {
    expect(summarizeCsat([])).toEqual({
      avgRating: 0,
      responseCount: 0,
      distribution: [0, 0, 0, 0, 0],
      dailyTrend: [],
    })
  })

  it('computes mean (2dp), response count, and the 1-5 distribution', () => {
    const s = summarizeCsat([
      { rating: 5, ratedAt: '2026-05-01T10:00:00Z' },
      { rating: 4, ratedAt: '2026-05-01T11:00:00Z' },
      { rating: 2, ratedAt: '2026-05-02T09:00:00Z' },
    ])
    expect(s.responseCount).toBe(3)
    expect(s.avgRating).toBe(3.67) // (5+4+2)/3 = 3.666… -> 3.67
    expect(s.distribution).toEqual([0, 1, 0, 1, 1]) // one 2, one 4, one 5
  })

  it('groups the daily trend by UTC date, ascending, with a per-day average', () => {
    const s = summarizeCsat([
      { rating: 2, ratedAt: '2026-05-02T09:00:00Z' },
      { rating: 5, ratedAt: '2026-05-01T10:00:00Z' },
      { rating: 3, ratedAt: '2026-05-01T23:30:00Z' },
    ])
    expect(s.dailyTrend).toEqual([
      { date: '2026-05-01', avgRating: 4, count: 2 }, // (5+3)/2
      { date: '2026-05-02', avgRating: 2, count: 1 },
    ])
  })

  it('ignores ratings outside 1-5 (defensive against bad rows)', () => {
    const s = summarizeCsat([
      { rating: 5, ratedAt: '2026-05-01T10:00:00Z' },
      { rating: 0, ratedAt: '2026-05-01T10:00:00Z' },
      { rating: 9, ratedAt: '2026-05-01T10:00:00Z' },
    ])
    expect(s.responseCount).toBe(1)
    expect(s.avgRating).toBe(5)
    expect(s.distribution).toEqual([0, 0, 0, 0, 1])
  })

  it('accepts Date objects as well as ISO strings', () => {
    const s = summarizeCsat([{ rating: 4, ratedAt: new Date('2026-05-03T12:00:00Z') }])
    expect(s.dailyTrend).toEqual([{ date: '2026-05-03', avgRating: 4, count: 1 }])
  })
})
