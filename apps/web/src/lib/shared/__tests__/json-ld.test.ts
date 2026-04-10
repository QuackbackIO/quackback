import { describe, it, expect } from 'vitest'
import { buildArticleJsonLd, buildBreadcrumbJsonLd, buildCollectionPageJsonLd } from '../json-ld'

describe('json-ld builders', () => {
  // ==========================================================================
  // buildArticleJsonLd
  // ==========================================================================
  describe('buildArticleJsonLd', () => {
    const baseInput = {
      title: 'Getting Started',
      description: 'Learn how to get started with our platform',
      content: 'Full article content goes here...',
      authorName: 'Jane Doe',
      publishedAt: '2026-03-15T10:00:00.000Z',
      updatedAt: '2026-04-01T12:00:00.000Z',
      baseUrl: 'https://help.example.com',
      categorySlug: 'basics',
      categoryName: 'Basics',
      articleSlug: 'getting-started',
    }

    it('returns Article type with correct context', () => {
      const result = buildArticleJsonLd(baseInput)
      expect(result['@context']).toBe('https://schema.org')
      expect(result['@type']).toBe('Article')
    })

    it('uses title as headline', () => {
      const result = buildArticleJsonLd(baseInput)
      expect(result.headline).toBe('Getting Started')
    })

    it('uses description when provided', () => {
      const result = buildArticleJsonLd(baseInput)
      expect(result.description).toBe('Learn how to get started with our platform')
    })

    it('falls back to first 160 chars of content when description is null', () => {
      const longContent = 'A'.repeat(200)
      const result = buildArticleJsonLd({
        ...baseInput,
        description: null,
        content: longContent,
      })
      expect(result.description).toBe('A'.repeat(160))
    })

    it('falls back to title when both description and content are null', () => {
      const result = buildArticleJsonLd({
        ...baseInput,
        description: null,
        content: null,
      })
      expect(result.description).toBe('Getting Started')
    })

    it('includes author when authorName is provided', () => {
      const result = buildArticleJsonLd(baseInput)
      expect(result.author).toEqual({ '@type': 'Person', name: 'Jane Doe' })
    })

    it('omits author when authorName is null', () => {
      const result = buildArticleJsonLd({ ...baseInput, authorName: null })
      expect(result.author).toBeUndefined()
    })

    it('includes datePublished when publishedAt is provided', () => {
      const result = buildArticleJsonLd(baseInput)
      expect(result.datePublished).toBe('2026-03-15T10:00:00.000Z')
    })

    it('omits datePublished when publishedAt is null', () => {
      const result = buildArticleJsonLd({ ...baseInput, publishedAt: null })
      expect(result.datePublished).toBeUndefined()
    })

    it('always includes dateModified', () => {
      const result = buildArticleJsonLd(baseInput)
      expect(result.dateModified).toBe('2026-04-01T12:00:00.000Z')
    })
  })

  // ==========================================================================
  // buildBreadcrumbJsonLd
  // ==========================================================================
  describe('buildBreadcrumbJsonLd', () => {
    it('returns BreadcrumbList type with correct context', () => {
      const result = buildBreadcrumbJsonLd([])
      expect(result['@context']).toBe('https://schema.org')
      expect(result['@type']).toBe('BreadcrumbList')
    })

    it('builds itemListElement with correct positions (1-indexed)', () => {
      const result = buildBreadcrumbJsonLd([
        { name: 'Help Center', url: 'https://help.example.com' },
        { name: 'Basics', url: 'https://help.example.com/basics' },
        { name: 'Getting Started', url: 'https://help.example.com/basics/getting-started' },
      ])

      const items = result.itemListElement as Array<Record<string, unknown>>
      expect(items).toHaveLength(3)

      expect(items[0]).toEqual({
        '@type': 'ListItem',
        position: 1,
        name: 'Help Center',
        item: 'https://help.example.com',
      })
      expect(items[1]).toEqual({
        '@type': 'ListItem',
        position: 2,
        name: 'Basics',
        item: 'https://help.example.com/basics',
      })
      expect(items[2]).toEqual({
        '@type': 'ListItem',
        position: 3,
        name: 'Getting Started',
        item: 'https://help.example.com/basics/getting-started',
      })
    })

    it('handles empty breadcrumbs', () => {
      const result = buildBreadcrumbJsonLd([])
      expect(result.itemListElement).toEqual([])
    })

    it('handles single breadcrumb', () => {
      const result = buildBreadcrumbJsonLd([
        { name: 'Help Center', url: 'https://help.example.com' },
      ])
      const items = result.itemListElement as Array<Record<string, unknown>>
      expect(items).toHaveLength(1)
      expect(items[0].position).toBe(1)
    })
  })

  // ==========================================================================
  // buildCollectionPageJsonLd
  // ==========================================================================
  describe('buildCollectionPageJsonLd', () => {
    it('returns CollectionPage type with correct context', () => {
      const result = buildCollectionPageJsonLd({ name: 'Basics', description: null })
      expect(result['@context']).toBe('https://schema.org')
      expect(result['@type']).toBe('CollectionPage')
    })

    it('includes name', () => {
      const result = buildCollectionPageJsonLd({ name: 'Getting Started', description: null })
      expect(result.name).toBe('Getting Started')
    })

    it('includes description when provided', () => {
      const result = buildCollectionPageJsonLd({
        name: 'Basics',
        description: 'Fundamental articles',
      })
      expect(result.description).toBe('Fundamental articles')
    })

    it('omits description when null', () => {
      const result = buildCollectionPageJsonLd({ name: 'Basics', description: null })
      expect(result.description).toBeUndefined()
    })
  })
})
