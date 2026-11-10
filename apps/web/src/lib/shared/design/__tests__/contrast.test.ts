import { describe, expect, it } from 'vitest'
import { apcaContrast, clearerInk, contrastRatio } from '../contrast'

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

describe('apcaContrast (APCA 0.0.98G)', () => {
  it('matches the published reference values, signed by polarity', () => {
    expect(apcaContrast('#888888', '#ffffff')).toBeCloseTo(63.06, 1)
    expect(apcaContrast('#ffffff', '#888888')).toBeCloseTo(-68.54, 1)
    expect(apcaContrast('#000000', '#aaaaaa')).toBeCloseTo(58.15, 1)
    expect(apcaContrast('#aaaaaa', '#000000')).toBeCloseTo(-56.24, 1)
    expect(apcaContrast('#112233', '#ddeeff')).toBeCloseTo(91.67, 1)
    expect(apcaContrast('#ddeeff', '#112233')).toBeCloseTo(-93.07, 1)
  })

  it('is zero for a colour on itself', () => {
    expect(apcaContrast('#0c73e5', '#0c73e5')).toBe(0)
  })

  it('reads the oklch() values the theme writes', () => {
    expect(apcaContrast('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(
      apcaContrast('#fff', '#000'),
      1
    )
  })
})

describe('clearerInk', () => {
  const INKS = ['#000000', '#ffffff']

  it('takes white over black on a mid blue where both reach 4.5:1 and white reads clearer', () => {
    // WCAG 2 puts black a hair ahead here (4.60 against 4.57); white reads far clearer.
    expect(contrastRatio('#000000', '#0c73e5')).toBeGreaterThan(contrastRatio('#ffffff', '#0c73e5'))
    expect(clearerInk('#000000', ['#0c73e5'], INKS)).toBe('#ffffff')
  })

  it('keeps black where white falls under 4.5:1, however it reads', () => {
    expect(contrastRatio('#ffffff', '#db483c')).toBeLessThan(4.5)
    expect(clearerInk('#000000', ['#db483c'], INKS)).toBe('#000000')
  })

  it('keeps the ink it is given where that reads clearer', () => {
    expect(clearerInk('#ffffff', ['#0c73e5'], INKS)).toBe('#ffffff')
    expect(clearerInk('#000000', ['#f4f4f5'], INKS)).toBe('#000000')
  })

  it('takes the first other ink on the far side of light that reaches 4.5:1', () => {
    // Near white misses on this blue; pure white makes it.
    expect(contrastRatio('oklch(0.985 0 0)', '#0c73e5')).toBeLessThan(4.5)
    expect(clearerInk('#111111', ['#0c73e5'], ['oklch(0.985 0 0)', '#ffffff'])).toBe('#ffffff')
  })

  it('measures every background, keeping the ink where the other misses on any', () => {
    expect(clearerInk('#000000', ['#0c73e5', '#db483c'], INKS)).toBe('#000000')
  })

  it('takes a lower target for large text', () => {
    expect(clearerInk('#000000', ['#db483c'], INKS, 3)).toBe('#ffffff')
  })
})
