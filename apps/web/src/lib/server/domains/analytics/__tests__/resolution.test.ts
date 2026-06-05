import { describe, it, expect } from 'vitest'
import { computeResolutionRate } from '../resolution'

const categories = new Map<string, string>([
  ['open', 'active'],
  ['in-progress', 'active'],
  ['complete', 'complete'],
  ['closed', 'closed'],
])

describe('computeResolutionRate', () => {
  it('counts complete + closed as resolved', () => {
    const r = computeResolutionRate(
      { open: 31, 'in-progress': 16, complete: 9, closed: 5 },
      categories
    )
    expect(r.totalPosts).toBe(61)
    expect(r.resolvedPosts).toBe(14)
    expect(r.resolutionRate).toBe(23) // round(14/61*100)
  })

  it('returns 0 when there are no posts', () => {
    expect(computeResolutionRate({}, categories)).toEqual({
      resolvedPosts: 0,
      totalPosts: 0,
      resolutionRate: 0,
    })
  })

  it('treats unknown / active-only slugs as unresolved', () => {
    const r = computeResolutionRate({ open: 4, mystery: 6 }, categories)
    expect(r.resolvedPosts).toBe(0)
    expect(r.resolutionRate).toBe(0)
  })

  it('reports 100% when every post is in a terminal status', () => {
    const r = computeResolutionRate({ complete: 3, closed: 7 }, categories)
    expect(r.resolutionRate).toBe(100)
  })
})
