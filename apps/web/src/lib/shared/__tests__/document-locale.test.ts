import { describe, it, expect } from 'vitest'
import { documentLocale } from '../document-locale'

describe('documentLocale', () => {
  it('uses the resolved locale on localized public surfaces', () => {
    expect(documentLocale('/', 'zh-cn')).toBe('zh-cn')
    expect(documentLocale('/changelog', 'zh-cn')).toBe('zh-cn')
    expect(documentLocale('/roadmap', 'zh-tw')).toBe('zh-tw')
    expect(documentLocale('/auth/login', 'zh-tw')).toBe('zh-tw')
    expect(documentLocale('/widget', 'ar')).toBe('ar')
  })
  it('keeps the English admin app on the default locale', () => {
    expect(documentLocale('/admin', 'zh-cn')).toBe('en')
    expect(documentLocale('/admin/posts', 'zh-cn')).toBe('en')
    expect(documentLocale('/admin/settings/branding', 'ar')).toBe('en')
  })
  it('localizes the admin sign-in page (it renders translated, unlike the rest of /admin)', () => {
    expect(documentLocale('/admin/login', 'zh-cn')).toBe('zh-cn')
    expect(documentLocale('/admin/login', 'zh-tw')).toBe('zh-tw')
  })
  it('keeps non-portal system routes on the default locale', () => {
    expect(documentLocale('/onboarding', 'ar')).toBe('en')
    expect(documentLocale('/api/v1/posts', 'zh-cn')).toBe('en')
    expect(documentLocale('/complete-signup/abc', 'zh-cn')).toBe('en')
    expect(documentLocale('/oauth/callback', 'zh-cn')).toBe('en')
  })
})
