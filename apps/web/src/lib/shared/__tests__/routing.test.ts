import { describe, it, expect } from 'vitest'
import { isSafeCallbackUrl, isTeamCallback } from '../routing'

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

  // Backslash open-redirect: some browsers normalise /\evil.com → //evil.com
  it('rejects "/\\evil.com" (backslash redirect)', () => {
    expect(isSafeCallbackUrl('/\\evil.com')).toBe(false)
  })

  it('rejects "/\\\\evil.com" (double-backslash redirect)', () => {
    expect(isSafeCallbackUrl('/\\\\evil.com')).toBe(false)
  })

  it('still accepts "/admin" (regression)', () => {
    expect(isSafeCallbackUrl('/admin')).toBe(true)
  })

  // Browsers strip tab, CR and LF from URLs before parsing, so "/\t/evil.com"
  // is fetched as "//evil.com": a protocol-relative jump to another host.
  it.each([
    ['tab', '/\t/evil.com'],
    ['newline', '/\n/evil.com'],
    ['carriage return', '/\r/evil.com'],
    ['leading space', ' //evil.com'],
    ['NUL', '/\0/evil.com'],
    ['DEL', '/\u007f/evil.com'],
  ])('rejects a %s smuggled between the slashes', (_label, url) => {
    expect(isSafeCallbackUrl(url)).toBe(false)
  })

  it('rejects a path that resolves to another origin', () => {
    expect(isSafeCallbackUrl('/\t\\evil.com')).toBe(false)
  })

  it('accepts a deep admin link with a query and a hash', () => {
    expect(isSafeCallbackUrl('/admin/inbox?view=open&c=conv_1#m2')).toBe(true)
  })

  it('accepts an encoded slash in the path (it stays a path)', () => {
    expect(isSafeCallbackUrl('/admin/%2F%2Fevil.com')).toBe(true)
  })
})

describe('isTeamCallback', () => {
  it('is true for admin paths', () => {
    expect(isTeamCallback('/admin')).toBe(true)
    expect(isTeamCallback('/admin/feedback')).toBe(true)
  })
  it('is true for team-invitation callbacks', () => {
    expect(isTeamCallback('/complete-signup/inv_123')).toBe(true)
  })
  it('is false for portal paths and undefined', () => {
    expect(isTeamCallback('/')).toBe(false)
    expect(isTeamCallback('/b/roadmap')).toBe(false)
    expect(isTeamCallback('/auth/login')).toBe(false)
    expect(isTeamCallback(undefined)).toBe(false)
  })
  it('is false for non-admin lookalikes', () => {
    expect(isTeamCallback('/administrator-handbook')).toBe(false)
    expect(isTeamCallback('/administrator?x=1')).toBe(false)
  })
  it('is true for admin paths carrying a query or a hash', () => {
    expect(isTeamCallback('/admin?post=post_1')).toBe(true)
    expect(isTeamCallback('/admin#plan')).toBe(true)
    expect(isTeamCallback('/admin/status?view=components')).toBe(true)
  })
})
