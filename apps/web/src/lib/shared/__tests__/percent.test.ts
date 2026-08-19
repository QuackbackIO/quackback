import { describe, it, expect } from 'vitest'
import { ratePctOrNull } from '../percent'

describe('ratePctOrNull', () => {
  it('is null (never NaN) when the denominator is zero', () => {
    expect(ratePctOrNull(0, 0)).toBeNull()
    expect(ratePctOrNull(5, 0)).toBeNull()
  })

  it('is the numerator/denominator ratio as a rounded 0-100 percent', () => {
    expect(ratePctOrNull(2, 2)).toBe(100)
    expect(ratePctOrNull(1, 4)).toBe(25)
    expect(ratePctOrNull(0, 4)).toBe(0)
  })

  it('rounds to the nearest whole percent', () => {
    expect(ratePctOrNull(1, 3)).toBe(33)
    expect(ratePctOrNull(2, 3)).toBe(67)
  })
})
