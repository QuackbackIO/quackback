import { describe, expect, it } from 'vitest'
import {
  getEmailDomain,
  isPersonalEmailDomain,
  companyEmailDomain,
} from '../personal-email-domains'
import { normalizeHexColor, hexContrastRatio, safeWebsiteBrandColor } from '../website-brand-color'
import { DEFAULT_LIGHT_BASE } from '../theme/expand'

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
  it('computes real contrast and checks the actual default light ink', () => {
    expect(hexContrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6)
    expect(hexContrastRatio('#000000', '#000000')).toBe(1)
    expect(safeWebsiteBrandColor('#FFFFFF')).toBe('#FFFFFF')
    expect(safeWebsiteBrandColor('#0A0A0A')).toBeNull()
    expect(safeWebsiteBrandColor('#0F766E')).toBeNull()
    expect(hexContrastRatio('#8FBC8F', DEFAULT_LIGHT_BASE.foreground)).toBeGreaterThanOrEqual(4.5)
    expect(safeWebsiteBrandColor('#8fbc8f')).toBe('#8FBC8F')
  })
})
