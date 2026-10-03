import { describe, expect, it } from 'vitest'
import {
  getEmailDomain,
  isPersonalEmailDomain,
  companyEmailDomain,
} from '../personal-email-domains'
import { normalizeHexColor, hexContrastRatio, safeWebsiteBrandColor } from '../website-brand-color'

describe('email domains for website branding', () => {
  it('normalizes a company domain from a valid email', () => {
    expect(getEmailDomain('you+tag@EXAMPLE.COM')).toBe('example.com')
    expect(companyEmailDomain('you@example.com')).toBe('example.com')
  })
  it('recognizes personal providers with case and regional domains', () => {
    for (const domain of [
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'yahoo.com',
      'yahoo.co.uk',
      'icloud.com',
      'proton.me',
      'protonmail.com',
      'live.com',
      'aol.com',
      'me.com',
      'gmx.de',
      'fastmail.com',
    ]) {
      expect(isPersonalEmailDomain(domain.toUpperCase())).toBe(true)
      expect(companyEmailDomain('you@' + domain)).toBeNull()
    }
    expect(isPersonalEmailDomain('gmail.com.example.com')).toBe(false)
  })
  it('rejects malformed addresses and unsafe literal hosts', () => {
    for (const email of [
      '',
      'you',
      '@example.com',
      'you@@example.com',
      'you@localhost',
      'you@127.0.0.1',
      'you@[::1]',
      'you@-example.com',
      'you@example..com',
      'you@example.com/path',
      'you@example.com:443',
      'you name@example.com',
      'you@example.com?x',
    ])
      expect(companyEmailDomain(email)).toBeNull()
  })
})
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
