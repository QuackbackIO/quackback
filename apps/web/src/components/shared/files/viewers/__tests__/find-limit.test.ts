import { describe, expect, it } from 'vitest'
import { stepMatch } from '../find-limit'

describe('stepMatch', () => {
  it('wraps around in both directions', () => {
    expect(stepMatch(0, 3, 1)).toBe(1)
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
    expect(stepMatch(-1, 3, 1)).toBe(0)
  })

  it('is -1 with nothing to step through', () => {
    expect(stepMatch(0, 0, 1)).toBe(-1)
  })
})
