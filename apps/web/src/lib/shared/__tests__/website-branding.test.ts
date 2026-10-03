import { describe, expect, it } from 'vitest'
import { normalizeHexColor, hexContrastRatio, safeWebsiteBrandColor } from '../website-brand-color'

describe('safe website color', () => {
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
  it('keeps real brand fills that carry white text', () => {
    for (const color of ['#0F766E', '#1D4ED8', '#7C3AED', '#B45309', '#059669'])
      expect(safeWebsiteBrandColor(color.toLowerCase())).toBe(color)
  })
  it('skips white and near-white theme colors that the fill under white text cannot carry', () => {
    for (const color of ['#FFFFFF', '#FAFAFA', '#fff', '#8FBC8F', '#F4AA00'])
      expect(safeWebsiteBrandColor(color)).toBeNull()
  })
  it('skips black, grey and slate theme colors with too little chroma to be a brand color', () => {
    for (const color of ['#000000', '#0A0A0A', '#18181B', '#6B7280', '#1E293B', '#475569'])
      expect(safeWebsiteBrandColor(color)).toBeNull()
  })
})
