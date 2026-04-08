import { describe, it, expect } from 'vitest'
import { computeHybridScore } from '../help-center-search.service'

describe('computeHybridScore', () => {
  it('combines both scores with 0.4 keyword + 0.6 semantic weights', () => {
    // keyword=0.8, semantic=0.9 => 0.4*0.8 + 0.6*0.9 = 0.32 + 0.54 = 0.86
    expect(computeHybridScore(0.8, 0.9)).toBeCloseTo(0.86, 10)
  })

  it('returns keyword score when only keyword is present', () => {
    expect(computeHybridScore(0.75, null)).toBe(0.75)
  })

  it('returns semantic score when only semantic is present', () => {
    expect(computeHybridScore(null, 0.65)).toBe(0.65)
  })

  it('returns 0 when both scores are null', () => {
    expect(computeHybridScore(null, null)).toBe(0)
  })

  it('handles zero scores correctly', () => {
    // Both zero => 0.4*0 + 0.6*0 = 0
    expect(computeHybridScore(0, 0)).toBe(0)
  })

  it('handles keyword=0 with non-null semantic', () => {
    // keyword=0, semantic=1.0 => 0.4*0 + 0.6*1.0 = 0.6
    expect(computeHybridScore(0, 1.0)).toBeCloseTo(0.6, 10)
  })

  it('handles non-null keyword with semantic=0', () => {
    // keyword=1.0, semantic=0 => 0.4*1.0 + 0.6*0 = 0.4
    expect(computeHybridScore(1.0, 0)).toBeCloseTo(0.4, 10)
  })

  it('handles perfect scores', () => {
    // keyword=1.0, semantic=1.0 => 0.4 + 0.6 = 1.0
    expect(computeHybridScore(1.0, 1.0)).toBeCloseTo(1.0, 10)
  })
})
