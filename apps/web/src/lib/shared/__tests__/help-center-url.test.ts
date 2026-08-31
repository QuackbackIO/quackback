import { describe, it, expect } from 'vitest'
import {
  getHelpCenterBaseUrl,
  localizedHcPath,
  parseHcLocalePath,
  resolveHcLandingLocale,
  formatHcIdSlug,
  parseHcIdSlug,
  hcArticlePath,
  hcCollectionPath,
} from '../help-center-url'

describe('getHelpCenterBaseUrl', () => {
  it('returns /hc as the inline help center base path', () => {
    expect(getHelpCenterBaseUrl()).toBe('/hc')
  })
})

describe('formatHcIdSlug / parseHcIdSlug', () => {
  it('joins a numeric id with the slug', () => {
    expect(formatHcIdSlug(42, 'what-is-quackback')).toBe('42-what-is-quackback')
  })

  it('omits the hyphen when the slug is empty', () => {
    expect(formatHcIdSlug(42, '')).toBe('42')
    expect(formatHcIdSlug(42, '---')).toBe('42')
  })

  it('round-trips a numeric article param', () => {
    const param = formatHcIdSlug(42, 'what-is-quackback')
    expect(parseHcIdSlug(param)).toEqual({
      urlId: 42,
      slug: 'what-is-quackback',
    })
  })

  it('parses an id with no slug', () => {
    expect(parseHcIdSlug('42')).toEqual({ urlId: 42, slug: '' })
  })

  it('rejects a legacy category slug that is not numeric', () => {
    expect(parseHcIdSlug('getting-started')).toBeNull()
  })

  it('rejects a leading-zero or ULID key so legacy slugs stay distinct', () => {
    expect(parseHcIdSlug('01m1cxgr9qf22rxt2vwk5jrchg-what-is-quackback')).toBeNull()
    expect(parseHcIdSlug('0-slug')).toBeNull()
  })
})

describe('hcArticlePath / hcCollectionPath', () => {
  it('always includes the locale, including the default', () => {
    expect(hcArticlePath({ locale: 'en', urlId: 42, slug: 'what-is-quackback' })).toBe(
      '/hc/en/articles/42-what-is-quackback'
    )
    expect(hcCollectionPath({ locale: 'en', urlId: 7, slug: 'getting-started' })).toBe(
      '/hc/en/collections/7-getting-started'
    )
  })

  it('prefixes additional locales the same way', () => {
    expect(hcArticlePath({ locale: 'de', urlId: 42, slug: 'intro' })).toBe(
      '/hc/de/articles/42-intro'
    )
  })
})

describe('localizedHcPath', () => {
  it('leaves the default-locale homepage unprefixed', () => {
    expect(localizedHcPath('en', '/hc')).toBe('/hc')
  })

  it('prefixes content paths even for the default locale', () => {
    expect(localizedHcPath('en', '/hc/collections/billing')).toBe('/hc/en/collections/billing')
  })

  it('prefixes an additional locale', () => {
    expect(localizedHcPath('de', '/hc/collections/billing')).toBe('/hc/de/collections/billing')
  })

  it('prefixes the bare homepage path for additional locales', () => {
    expect(localizedHcPath('de', '/hc')).toBe('/hc/de')
  })

  it('prefixes an article path', () => {
    expect(localizedHcPath('fr', '/hc/articles/id-slug')).toBe('/hc/fr/articles/id-slug')
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
    expect(resolveHcLandingLocale({ ...base, cookieLocale: 'fr', acceptLanguage: 'de' })).toBe('fr')
  })

  it('an explicit cookie choice of the default locale is honored (no redirect)', () => {
    expect(resolveHcLandingLocale({ ...base, cookieLocale: 'en', acceptLanguage: 'de' })).toBeNull()
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
    expect(resolveHcLandingLocale({ ...base, cookieLocale: null, acceptLanguage: 'ja' })).toBeNull()
  })

  it('stays on default when Accept-Language resolves to the default locale itself', () => {
    expect(
      resolveHcLandingLocale({ ...base, cookieLocale: null, acceptLanguage: 'en-US' })
    ).toBeNull()
  })
})
