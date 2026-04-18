import { describe, it, expect } from 'vitest'
import { buildHelpCenterSitemapUrls } from '../help-center-sitemap'

describe('buildHelpCenterSitemapUrls', () => {
  const baseUrl = 'https://help.example.com'

  it('always includes the landing page first', () => {
    const urls = buildHelpCenterSitemapUrls(baseUrl, [], [])
    expect(urls).toHaveLength(1)
    expect(urls[0]).toEqual({ loc: 'https://help.example.com' })
  })

  it('includes category pages without lastmod', () => {
    const categories = [{ slug: 'basics' }, { slug: 'advanced' }]
    const urls = buildHelpCenterSitemapUrls(baseUrl, categories, [])

    expect(urls).toHaveLength(3) // landing + 2 categories
    expect(urls[1]).toEqual({ loc: 'https://help.example.com/categories/basics' })
    expect(urls[2]).toEqual({ loc: 'https://help.example.com/categories/advanced' })
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
      loc: 'https://help.example.com/articles/basics/getting-started',
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
      'https://help.example.com',
      'https://help.example.com/categories/basics',
      'https://help.example.com/categories/api',
      'https://help.example.com/articles/basics/getting-started',
      'https://help.example.com/articles/api/auth-tokens',
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
