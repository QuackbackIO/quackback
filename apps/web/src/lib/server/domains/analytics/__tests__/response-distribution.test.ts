import { describe, it, expect } from 'vitest'
import { buildResponseDistribution, RESPONSE_BUCKETS } from '../response-distribution'

describe('buildResponseDistribution', () => {
  it('groups first-response waits into the wait-time buckets, counting boundary inclusively below', () => {
    const r = buildResponseDistribution(
      [
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-01T09:02:00Z' }, // 2m → <5m
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-01T09:05:00Z' }, // exactly 5m → 5–30m
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-01T09:20:00Z' }, // 20m → 5–30m
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-01T09:45:00Z' }, // 45m → 30m–1h
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-01T11:00:00Z' }, // 2h → 1–4h
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-01T21:00:00Z' }, // 12h → 4–24h
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-03T09:00:00Z' }, // 2d → 1–3d
        { createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-06T09:00:00Z' }, // 5d → >3d
      ],
      '2026-07-01',
      '2026-07-31'
    )
    expect(r.buckets).toEqual([
      { label: '<5m', count: 1 },
      { label: '5–30m', count: 2 },
      { label: '30m–1h', count: 1 },
      { label: '1–4h', count: 1 },
      { label: '4–24h', count: 1 },
      { label: '1–3d', count: 1 },
      { label: '>3d', count: 1 },
    ])
    expect(r.total).toBe(8)
  })

  it('keeps empty buckets at zero so the histogram axis never collapses', () => {
    const r = buildResponseDistribution(
      [{ createdAt: '2026-07-01T09:00:00Z', firstResponseAt: '2026-07-01T09:01:00Z' }],
      '2026-07-01',
      '2026-07-31'
    )
    expect(r.buckets).toHaveLength(RESPONSE_BUCKETS.length)
    expect(r.buckets.filter((b) => b.count === 0)).toHaveLength(RESPONSE_BUCKETS.length - 1)
    expect(r.total).toBe(1)
  })

  it('drops rows outside the window and unanswered rows never reach the function', () => {
    const r = buildResponseDistribution(
      [{ createdAt: '2026-06-01T09:00:00Z', firstResponseAt: '2026-06-01T09:05:00Z' }],
      '2026-07-01',
      '2026-07-31'
    )
    expect(r.total).toBe(0)
    expect(r.buckets.every((b) => b.count === 0)).toBe(true)
  })
})
