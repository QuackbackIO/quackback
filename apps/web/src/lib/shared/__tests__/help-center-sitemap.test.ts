import { describe, it, expect } from 'vitest'
import { buildHelpCenterSitemapUrls, buildHelpCenterSitemapUrlsMultiLocale } from '../help-center-sitemap'

describe('buildHelpCenterSitemapUrls', () => {
  const baseUrl = 'https://help.example.com'

  it('always includes the landing page first, under /hc', () => {
    const urls = buildHelpCenterSitemapUrls(baseUrl, [], [])
    expect(urls).toHaveLength(1)
    expect(urls[0]).toEqual({ loc: 'https://help.example.com/hc' })
  })

  it('includes category pages without lastmod', () => {
    const categories = [{ slug: 'basics' }, { slug: 'advanced' }]
    const urls = buildHelpCenterSitemapUrls(baseUrl, categories, [])

    expect(urls).toHaveLength(3) // landing + 2 categories
    expect(urls[1]).toEqual({ loc: 'https://help.example.com/hc/categories/basics' })
    expect(urls[2]).toEqual({ loc: 'https://help.example.com/hc/categories/advanced' })
  })

  it('includes article pages with lastmod from updatedAt', () => {
    const articles = [
      {
        slug: 'getting-started',
        updatedAt: '2026-04-01T12:00:00.000Z',
        category: { slug: 'basics' },
      },
    ]
    const urls = buildHelpCenterSitemapUrls(baseUrl, [], articles)

    expect(urls).toHaveLength(2) // landing + 1 article
    expect(urls[1]).toEqual({
      loc: 'https://help.example.com/hc/articles/basics/getting-started',
      lastmod: '2026-04-01',
    })
  })

  it('builds full sitemap with categories and articles', () => {
    const categories = [{ slug: 'basics' }, { slug: 'api' }]
    const articles = [
      {
        slug: 'getting-started',
        updatedAt: '2026-03-15T10:00:00.000Z',
        category: { slug: 'basics' },
      },
      {
        slug: 'auth-tokens',
        updatedAt: '2026-04-02T08:30:00.000Z',
        category: { slug: 'api' },
      },
    ]

    const urls = buildHelpCenterSitemapUrls(baseUrl, categories, articles)

    expect(urls).toHaveLength(5) // 1 landing + 2 categories + 2 articles
    expect(urls.map((u) => u.loc)).toEqual([
      'https://help.example.com/hc',
      'https://help.example.com/hc/categories/basics',
      'https://help.example.com/hc/categories/api',
      'https://help.example.com/hc/articles/basics/getting-started',
      'https://help.example.com/hc/articles/api/auth-tokens',
    ])
  })

  it('extracts date portion from ISO timestamp for lastmod', () => {
    const articles = [
      {
        slug: 'test',
        updatedAt: '2026-12-25T23:59:59.999Z',
        category: { slug: 'cat' },
      },
    ]
    const urls = buildHelpCenterSitemapUrls(baseUrl, [{ slug: 'cat' }], articles)
    const articleUrl = urls.find((u) => u.loc.includes('/test'))
    expect(articleUrl?.lastmod).toBe('2026-12-25')
  })

  it('landing page has no lastmod', () => {
    const urls = buildHelpCenterSitemapUrls(baseUrl, [], [])
    expect(urls[0].lastmod).toBeUndefined()
  })

  it('category pages have no lastmod', () => {
    const urls = buildHelpCenterSitemapUrls(baseUrl, [{ slug: 'basics' }], [])
    expect(urls[1].lastmod).toBeUndefined()
  })
})

describe('buildHelpCenterSitemapUrlsMultiLocale', () => {
  const baseUrl = 'https://help.example.com'

  it('emits one landing page per locale, cross-linked with hreflang alternates', () => {
    const urls = buildHelpCenterSitemapUrlsMultiLocale(baseUrl, 'en', [
      { locale: 'en', categories: [], articles: [] },
      { locale: 'de', categories: [], articles: [] },
    ])

    expect(urls).toHaveLength(2)
    const en = urls.find((u) => u.loc === 'https://help.example.com/hc')!
    const de = urls.find((u) => u.loc === 'https://help.example.com/hc/de')!
    expect(en.alternates).toEqual(
      expect.arrayContaining([
        { hreflang: 'en', href: 'https://help.example.com/hc' },
        { hreflang: 'de', href: 'https://help.example.com/hc/de' },
        { hreflang: 'x-default', href: 'https://help.example.com/hc' },
      ])
    )
    expect(de.alternates).toEqual(en.alternates)
  })

  it('cross-links a category visible in two locales', () => {
    const urls = buildHelpCenterSitemapUrlsMultiLocale(baseUrl, 'en', [
      { locale: 'en', categories: [{ id: 'cat_1', slug: 'billing' }], articles: [] },
      { locale: 'de', categories: [{ id: 'cat_1', slug: 'billing' }], articles: [] },
    ])

    const enCat = urls.find((u) => u.loc === 'https://help.example.com/hc/categories/billing')!
    const deCat = urls.find(
      (u) => u.loc === 'https://help.example.com/hc/de/categories/billing'
    )!
    expect(enCat.alternates).toContainEqual({
      hreflang: 'de',
      href: 'https://help.example.com/hc/de/categories/billing',
    })
    expect(deCat.alternates).toContainEqual({
      hreflang: 'x-default',
      href: 'https://help.example.com/hc/categories/billing',
    })
  })

  it('does not cross-link a category only visible in one locale', () => {
    const urls = buildHelpCenterSitemapUrlsMultiLocale(baseUrl, 'en', [
      { locale: 'en', categories: [{ id: 'cat_1', slug: 'billing' }], articles: [] },
      { locale: 'de', categories: [], articles: [] },
    ])

    const enCat = urls.find((u) => u.loc === 'https://help.example.com/hc/categories/billing')!
    expect(enCat.alternates).toEqual([
      { hreflang: 'en', href: 'https://help.example.com/hc/categories/billing' },
      { hreflang: 'x-default', href: 'https://help.example.com/hc/categories/billing' },
    ])
  })

  it('cross-links articles by id with per-locale lastmod', () => {
    const urls = buildHelpCenterSitemapUrlsMultiLocale(baseUrl, 'en', [
      {
        locale: 'en',
        categories: [],
        articles: [
          {
            id: 'art_1',
            slug: 'invoices',
            updatedAt: '2026-01-01T00:00:00.000Z',
            category: { slug: 'billing' },
          },
        ],
      },
      {
        locale: 'de',
        categories: [],
        articles: [
          {
            id: 'art_1',
            slug: 'invoices',
            updatedAt: '2026-02-02T00:00:00.000Z',
            category: { slug: 'billing' },
          },
        ],
      },
    ])

    const en = urls.find(
      (u) => u.loc === 'https://help.example.com/hc/articles/billing/invoices'
    )!
    const de = urls.find(
      (u) => u.loc === 'https://help.example.com/hc/de/articles/billing/invoices'
    )!
    expect(en.lastmod).toBe('2026-01-01')
    expect(de.lastmod).toBe('2026-02-02')
    expect(en.alternates).toContainEqual({ hreflang: 'de', href: de.loc })
  })
})
