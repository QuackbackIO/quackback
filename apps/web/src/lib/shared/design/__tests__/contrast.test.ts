import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'

describe('contrastRatio (WCAG 2.x)', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#0f766e', '#0f766e')).toBe(1)
  })

  it('does not depend on which colour is the text', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBe(contrastRatio('#ffffff', '#777777'))
  })

  it('matches known values', () => {
    // #777777 on white is the classic just-under-AA grey.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(contrastRatio('#525252', '#ffffff')).toBeCloseTo(7.81, 2)
  })

  it('reads the oklch() values the theme writes', () => {
    expect(contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 1)
    expect(contrastRatio('oklch(0.145 0 0)', '#ffffff')).toBeGreaterThan(17)
  })

  it('measures a translucent colour as it shows over the background', () => {
    // Half-white over black shows as mid grey (#808080).
    expect(contrastRatio('oklch(1 0 0 / 50%)', '#000000')).toBeCloseTo(
      contrastRatio('#808080', '#000000'),
      2
    )
    expect(contrastRatio('#ffffff80', '#000000')).toBeCloseTo(
      contrastRatio('#808080', '#000000'),
      2
    )
  })

  it('accepts short hex', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
  })

  it('refuses a colour it cannot read', () => {
    expect(() => contrastRatio('rebeccapurple', '#ffffff')).toThrow(/rebeccapurple/)
  })
})
