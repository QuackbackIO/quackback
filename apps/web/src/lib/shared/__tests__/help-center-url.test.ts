import { describe, it, expect } from 'vitest'
import {
  getHelpCenterBaseUrl,
  localizedHcPath,
  parseHcLocalePath,
  resolveHcLandingLocale,
} from '../help-center-url'

describe('getHelpCenterBaseUrl', () => {
  it('returns /hc as the inline help center base path', () => {
    expect(getHelpCenterBaseUrl()).toBe('/hc')
  })
})

describe('localizedHcPath', () => {
  it('leaves the default locale unprefixed', () => {
    expect(localizedHcPath('en', '/hc/categories/billing')).toBe('/hc/categories/billing')
  })

  it('prefixes an additional locale', () => {
    expect(localizedHcPath('de', '/hc/categories/billing')).toBe('/hc/de/categories/billing')
  })

  it('prefixes the bare homepage path', () => {
    expect(localizedHcPath('de', '/hc')).toBe('/hc/de')
  })

  it('prefixes an article path', () => {
    expect(localizedHcPath('fr', '/hc/articles/billing/invoices')).toBe(
      '/hc/fr/articles/billing/invoices'
    )
  })
})

describe('parseHcLocalePath', () => {
  const enabledLocales = ['de', 'fr']

  it('treats an unprefixed path as the default locale', () => {
    expect(parseHcLocalePath('/hc/categories/billing', enabledLocales)).toEqual({
      locale: 'en',
      canonicalPath: '/hc/categories/billing',
    })
  })

  it('recovers the locale and canonical path from a prefixed URL', () => {
    expect(parseHcLocalePath('/hc/de/categories/billing', enabledLocales)).toEqual({
      locale: 'de',
      canonicalPath: '/hc/categories/billing',
    })
  })

  it('recovers the bare locale homepage', () => {
    expect(parseHcLocalePath('/hc/de', enabledLocales)).toEqual({
      locale: 'de',
      canonicalPath: '/hc',
    })
  })

  it('does not mistake the static "categories"/"articles" segments for a locale, since callers only ever pass real SupportedLocale codes as enabledLocales', () => {
    expect(parseHcLocalePath('/hc/categories/billing', enabledLocales)).toEqual({
      locale: 'en',
      canonicalPath: '/hc/categories/billing',
    })
    expect(parseHcLocalePath('/hc/articles/billing/invoices', enabledLocales)).toEqual({
      locale: 'en',
      canonicalPath: '/hc/articles/billing/invoices',
    })
  })

  it('falls back to default locale when the first segment is not enabled', () => {
    expect(parseHcLocalePath('/hc/zz/categories/billing', enabledLocales)).toEqual({
      locale: 'en',
      canonicalPath: '/hc/zz/categories/billing',
    })
  })
})

describe('resolveHcLandingLocale', () => {
  const base = { enabledAdditionalLocales: ['de', 'fr'], defaultLocale: 'en' }

  it('never redirects when no additional locale is enabled', () => {
    expect(
      resolveHcLandingLocale({
        cookieLocale: 'de',
        acceptLanguage: 'de',
        enabledAdditionalLocales: [],
        defaultLocale: 'en',
      })
    ).toBeNull()
  })

  it('a manual cookie choice wins over Accept-Language', () => {
    expect(
      resolveHcLandingLocale({ ...base, cookieLocale: 'fr', acceptLanguage: 'de' })
    ).toBe('fr')
  })

  it('an explicit cookie choice of the default locale is honored (no redirect)', () => {
    expect(
      resolveHcLandingLocale({ ...base, cookieLocale: 'en', acceptLanguage: 'de' })
    ).toBeNull()
  })

  it('ignores a stale cookie referencing a since-disabled locale', () => {
    expect(
      resolveHcLandingLocale({ ...base, cookieLocale: 'zh-cn', acceptLanguage: null })
    ).toBeNull()
  })

  it('falls back to Accept-Language detection with no cookie', () => {
    expect(
      resolveHcLandingLocale({ ...base, cookieLocale: null, acceptLanguage: 'de-DE,de;q=0.9' })
    ).toBe('de')
  })

  it('stays on default when Accept-Language does not match an enabled locale', () => {
    expect(
      resolveHcLandingLocale({ ...base, cookieLocale: null, acceptLanguage: 'ja' })
    ).toBeNull()
  })

  it('stays on default when Accept-Language resolves to the default locale itself', () => {
    expect(
      resolveHcLandingLocale({ ...base, cookieLocale: null, acceptLanguage: 'en-US' })
    ).toBeNull()
  })
})
