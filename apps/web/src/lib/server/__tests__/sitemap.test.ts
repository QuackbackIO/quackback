import { describe, it, expect } from 'vitest'
import {
  buildSitemap,
  buildSitemapIndex,
  escapeXml,
  MAX_URLS_PER_SITEMAP,
  renderSitemap,
  toW3CDate,
} from '../sitemap'
import type { SitemapUrl } from '../sitemap'

describe('sitemap helpers', () => {
  describe('toW3CDate', () => {
    it('formats date as YYYY-MM-DD', () => {
      expect(toW3CDate(new Date('2026-02-23T15:30:00Z'))).toBe('2026-02-23')
    })

    it('handles midnight UTC', () => {
      expect(toW3CDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01')
    })
  })

  describe('escapeXml', () => {
    it('escapes ampersands', () => {
      expect(escapeXml('foo&bar')).toBe('foo&amp;bar')
    })

    it('escapes angle brackets', () => {
      expect(escapeXml('<tag>')).toBe('&lt;tag&gt;')
    })

    it('leaves clean strings unchanged', () => {
      expect(escapeXml('https://example.com/path')).toBe('https://example.com/path')
    })
  })

  describe('buildSitemap', () => {
    it('generates valid XML with loc only', () => {
      const xml = buildSitemap([{ loc: 'https://example.com' }])
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
      expect(xml).toContain('<loc>https://example.com</loc>')
      expect(xml).not.toContain('<lastmod>')
    })

    it('includes lastmod when provided', () => {
      const xml = buildSitemap([{ loc: 'https://example.com', lastmod: '2026-02-23' }])
      expect(xml).toContain('<lastmod>2026-02-23</lastmod>')
    })

    it('escapes special characters in URLs', () => {
      const xml = buildSitemap([{ loc: 'https://example.com/a&b' }])
      expect(xml).toContain('<loc>https://example.com/a&amp;b</loc>')
    })

    it('handles empty URL list', () => {
      const xml = buildSitemap([])
      expect(xml).toContain('<urlset')
      expect(xml).not.toContain('<url>')
    })

    it('does not include priority or changefreq', () => {
      const xml = buildSitemap([{ loc: 'https://example.com', lastmod: '2026-01-01' }])
      expect(xml).not.toContain('<priority>')
      expect(xml).not.toContain('<changefreq>')
    })
  })

  describe('buildSitemapIndex', () => {
    it('generates index with correct page links', () => {
      const xml = buildSitemapIndex('https://example.com', 3)
      expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
      expect(xml).toContain('<loc>https://example.com/sitemap.xml?page=1</loc>')
      expect(xml).toContain('<loc>https://example.com/sitemap.xml?page=2</loc>')
      expect(xml).toContain('<loc>https://example.com/sitemap.xml?page=3</loc>')
    })

    it('generates single-page index', () => {
      const xml = buildSitemapIndex('https://example.com', 1)
      expect(xml).toContain('page=1')
      expect(xml).not.toContain('page=2')
    })
  })

  describe('renderSitemap', () => {
    const makeUrls = (count: number): SitemapUrl[] =>
      Array.from({ length: count }, (_, i) => ({ loc: `https://example.com/${i}` }))

    it('returns single sitemap when under the limit', () => {
      const urls = makeUrls(10)
      const xml = renderSitemap(urls, 'https://example.com', null)
      expect(xml).toContain('<urlset')
      expect(xml).not.toContain('<sitemapindex')
    })

    it('returns single sitemap at exactly the limit', () => {
      const urls = makeUrls(MAX_URLS_PER_SITEMAP)
      const xml = renderSitemap(urls, 'https://example.com', null)
      expect(xml).toContain('<urlset')
      expect(xml).not.toContain('<sitemapindex')
    })

    it('returns sitemap index when over the limit', () => {
      const urls = makeUrls(MAX_URLS_PER_SITEMAP + 1)
      const xml = renderSitemap(urls, 'https://example.com', null)
      expect(xml).toContain('<sitemapindex')
      expect(xml).toContain('page=1')
      expect(xml).toContain('page=2')
    })

    it('returns correct page slice', () => {
      const urls = makeUrls(MAX_URLS_PER_SITEMAP + 5)
      const page1 = renderSitemap(urls, 'https://example.com', 1)!
      const page2 = renderSitemap(urls, 'https://example.com', 2)!

      // Page 1 should have the full limit
      const page1Matches = page1.match(/<url>/g)
      expect(page1Matches).toHaveLength(MAX_URLS_PER_SITEMAP)

      // Page 2 should have the remainder
      const page2Matches = page2.match(/<url>/g)
      expect(page2Matches).toHaveLength(5)
    })

    it('returns null for invalid page numbers', () => {
      const urls = makeUrls(10)
      expect(renderSitemap(urls, 'https://example.com', 0)).toBeNull()
      expect(renderSitemap(urls, 'https://example.com', 2)).toBeNull()
      expect(renderSitemap(urls, 'https://example.com', -1)).toBeNull()
    })

    it('returns page 1 for single-page set when page=1 requested', () => {
      // Edge case: under the limit but explicit page=1 requested
      // With <=50k URLs, totalPages=1, so page=1 is valid
      const urls = makeUrls(10)
      const xml = renderSitemap(urls, 'https://example.com', 1)
      // Under the limit with an explicit page goes through index mode
      // totalPages = 1, page 1 is valid, should return the sitemap
      expect(xml).toContain('<urlset')
    })
  })
})
