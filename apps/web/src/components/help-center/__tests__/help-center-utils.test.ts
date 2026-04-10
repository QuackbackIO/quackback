import { describe, it, expect } from 'vitest'
import {
  getTopLevelCategories,
  getActiveCategory,
  truncateContent,
  getSubcategories,
  buildCategoryBreadcrumbs,
} from '../help-center-utils'

interface TestCategory {
  id: string
  parentId?: string | null
  slug: string
  name: string
}

describe('getTopLevelCategories', () => {
  it('filters out categories with a parentId', () => {
    const categories: TestCategory[] = [
      { id: '1', parentId: null, slug: 'getting-started', name: 'Getting Started' },
      { id: '2', parentId: '1', slug: 'install', name: 'Install' },
      { id: '3', parentId: null, slug: 'faq', name: 'FAQ' },
    ]

    const result = getTopLevelCategories(categories)
    expect(result).toHaveLength(2)
    expect(result.map((c) => c.slug)).toEqual(['getting-started', 'faq'])
  })

  it('treats undefined parentId as top-level', () => {
    const categories: TestCategory[] = [
      { id: '1', slug: 'top', name: 'Top' },
      { id: '2', parentId: '1', slug: 'child', name: 'Child' },
    ]

    const result = getTopLevelCategories(categories)
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('top')
  })

  it('returns empty array for empty input', () => {
    expect(getTopLevelCategories([])).toEqual([])
  })
})

describe('getActiveCategory', () => {
  it('returns null when pathname is /', () => {
    expect(getActiveCategory('/')).toBeNull()
  })

  it('returns the first path segment as the category slug', () => {
    expect(getActiveCategory('/getting-started')).toBe('getting-started')
  })

  it('returns the first path segment for nested paths', () => {
    expect(getActiveCategory('/faq/how-to-reset')).toBe('faq')
  })

  it('returns null for empty pathname', () => {
    expect(getActiveCategory('')).toBeNull()
  })
})

describe('truncateContent', () => {
  it('returns content unchanged when under limit', () => {
    expect(truncateContent('hello', 10)).toBe('hello')
  })

  it('truncates and appends ellipsis when over limit', () => {
    expect(truncateContent('hello world foo bar', 11)).toBe('hello world...')
  })

  it('handles empty string', () => {
    expect(truncateContent('', 10)).toBe('')
  })

  it('uses default limit of 150', () => {
    const long = 'a'.repeat(200)
    const result = truncateContent(long)
    expect(result).toBe('a'.repeat(150) + '...')
  })
})

describe('getSubcategories', () => {
  const categories: TestCategory[] = [
    { id: '1', parentId: null, slug: 'getting-started', name: 'Getting Started' },
    { id: '2', parentId: '1', slug: 'first-steps', name: 'First Steps' },
    { id: '3', parentId: '1', slug: 'advanced', name: 'Advanced' },
    { id: '4', parentId: null, slug: 'faq', name: 'FAQ' },
    { id: '5', parentId: '4', slug: 'billing', name: 'Billing' },
  ]

  it('returns children of a given parent', () => {
    const result = getSubcategories(categories, '1')
    expect(result).toHaveLength(2)
    expect(result.map((c) => c.slug)).toEqual(['first-steps', 'advanced'])
  })

  it('returns empty array when no children exist', () => {
    const result = getSubcategories(categories, '2')
    expect(result).toHaveLength(0)
  })

  it('returns empty array for empty categories list', () => {
    expect(getSubcategories([], '1')).toEqual([])
  })

  it('returns children for a different parent', () => {
    const result = getSubcategories(categories, '4')
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('billing')
  })
})

describe('buildCategoryBreadcrumbs', () => {
  it('builds breadcrumbs with just category', () => {
    const result = buildCategoryBreadcrumbs({
      categoryName: 'Getting Started',
      categorySlug: 'getting-started',
    })

    expect(result).toEqual([{ label: 'Help Center', href: '/hc' }, { label: 'Getting Started' }])
  })

  it('builds breadcrumbs with category and article', () => {
    const result = buildCategoryBreadcrumbs({
      categoryName: 'Getting Started',
      categorySlug: 'getting-started',
      articleTitle: 'Quick Start Guide',
    })

    expect(result).toEqual([
      { label: 'Help Center', href: '/hc' },
      { label: 'Getting Started', href: '/hc/getting-started' },
      { label: 'Quick Start Guide' },
    ])
  })
})
