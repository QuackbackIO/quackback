import { describe, it, expect } from 'vitest'
import { getTopLevelCategories, getActiveCategory, truncateContent } from '../help-center-utils'

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
