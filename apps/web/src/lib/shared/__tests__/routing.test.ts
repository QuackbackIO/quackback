import { describe, it, expect } from 'vitest'
import { isSafeCallbackUrl } from '../routing'

describe('isSafeCallbackUrl', () => {
  // Accepted values
  it('accepts "/"', () => {
    expect(isSafeCallbackUrl('/')).toBe(true)
  })

  it('accepts "/portal-invite/abc"', () => {
    expect(isSafeCallbackUrl('/portal-invite/abc')).toBe(true)
  })

  it('accepts "/some/deep/path?q=1"', () => {
    expect(isSafeCallbackUrl('/some/deep/path?q=1')).toBe(true)
  })

  it('accepts paths with hyphens and underscores', () => {
    expect(isSafeCallbackUrl('/admin/settings-permissions')).toBe(true)
  })

  // Rejected values — open-redirect vectors
  it('rejects "//evil.com" (protocol-relative)', () => {
    expect(isSafeCallbackUrl('//evil.com')).toBe(false)
  })

  it('rejects "https://evil.com" (absolute URL)', () => {
    expect(isSafeCallbackUrl('https://evil.com')).toBe(false)
  })

  it('rejects "http://evil.com"', () => {
    expect(isSafeCallbackUrl('http://evil.com')).toBe(false)
  })

  it('rejects "javascript:alert(1)" (script-protocol)', () => {
    expect(isSafeCallbackUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects plain "evil.com" (no leading slash)', () => {
    expect(isSafeCallbackUrl('evil.com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isSafeCallbackUrl('')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isSafeCallbackUrl(undefined)).toBe(false)
  })

  it('rejects null', () => {
    expect(isSafeCallbackUrl(null)).toBe(false)
  })

  it('rejects a number', () => {
    expect(isSafeCallbackUrl(42)).toBe(false)
  })
})
