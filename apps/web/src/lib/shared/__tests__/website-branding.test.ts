import { describe, expect, it } from 'vitest'
import { normalizeHexColor, hexContrastRatio } from '../website-brand-color'

describe('website hex colors', () => {
  it('accepts only normalized opaque hex', () => {
    expect(normalizeHexColor(' #aBc ')).toBe('#AABBCC')
    expect(normalizeHexColor('#abcdef')).toBe('#ABCDEF')
    for (const value of [
      '#abcd',
      '#ffffff00',
      'transparent',
      'url(x)',
      'red',
      'rgb(1,2,3)',
      '##fff',
      '#gggggg',
    ])
      expect(normalizeHexColor(value)).toBeNull()
  })
  it('computes real contrast', () => {
    expect(hexContrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6)
    expect(hexContrastRatio('#000000', '#000000')).toBe(1)
    expect(hexContrastRatio('#0F766E', '#FFFFFF')).toBeCloseTo(5.47, 2)
  })
})
