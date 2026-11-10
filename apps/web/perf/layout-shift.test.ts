import { describe, expect, it } from 'vitest'
import { layoutShiftScore } from './layout-shift'

describe('layoutShiftScore', () => {
  it('is 0 for a page that never moves', () => {
    expect(layoutShiftScore([])).toBe(0)
  })

  it('adds the shifts of one burst', () => {
    expect(
      layoutShiftScore([
        { t: 100, v: 0.01 },
        { t: 400, v: 0.02 },
        { t: 1200, v: 0.03 },
      ])
    ).toBe(0.06)
  })

  it('scores the largest window, not the sum, once a second passes between shifts', () => {
    expect(
      layoutShiftScore([
        { t: 100, v: 0.05 },
        { t: 1500, v: 0.02 },
        { t: 1600, v: 0.02 },
      ])
    ).toBe(0.05)
  })

  it('starts a new window after five seconds of steady shifting', () => {
    const steady = Array.from({ length: 12 }, (_, i) => ({ t: i * 800, v: 0.01 }))
    // 0 to 4800 ms is one window of seven shifts; the rest start another.
    expect(layoutShiftScore(steady)).toBe(0.07)
  })

  it('reads the shifts in time order', () => {
    expect(
      layoutShiftScore([
        { t: 1600, v: 0.02 },
        { t: 100, v: 0.05 },
        { t: 1500, v: 0.02 },
      ])
    ).toBe(0.05)
  })

  it('rounds away a shift too small to see', () => {
    expect(layoutShiftScore([{ t: 0, v: 0.00004 }])).toBe(0)
  })
})
