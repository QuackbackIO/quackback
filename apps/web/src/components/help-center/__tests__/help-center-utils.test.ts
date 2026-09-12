import { describe, it, expect } from 'vitest'
import { getTopLevelCategories, buildCategoryBreadcrumbs } from '../help-center-utils'

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

describe('buildCategoryBreadcrumbs (hierarchical)', () => {
  const tree = [
    { id: 'root', urlId: 1, parentId: null, slug: 'root', name: 'Root' },
    { id: 'mid', urlId: 2, parentId: 'root', slug: 'mid', name: 'Middle' },
    { id: 'leaf', urlId: 3, parentId: 'mid', slug: 'leaf', name: 'Leaf' },
  ]

  it('returns Help Center > Category for a top-level category', () => {
    const items = buildCategoryBreadcrumbs({
      allCategories: tree,
      categoryId: 'root',
    })
    expect(items.map((i) => i.label)).toEqual(['Help Center', 'Root'])
    expect(items[0].href).toBe('/hc')
    expect(items[1].href).toBeUndefined()
  })

  it('walks the full chain for a nested category', () => {
    const items = buildCategoryBreadcrumbs({
      allCategories: tree,
      categoryId: 'leaf',
    })
    expect(items.map((i) => i.label)).toEqual(['Help Center', 'Root', 'Middle', 'Leaf'])
    expect(items[1].href).toBe('/hc/en/collections/1-root')
    expect(items[2].href).toBe('/hc/en/collections/2-mid')
    expect(items[3].href).toBeUndefined()
  })

  it('appends the article title as a final non-linked crumb', () => {
    const items = buildCategoryBreadcrumbs({
      allCategories: tree,
      categoryId: 'leaf',
      articleTitle: 'Installing the CLI',
    })
    expect(items.map((i) => i.label)).toEqual([
      'Help Center',
      'Root',
      'Middle',
      'Leaf',
      'Installing the CLI',
    ])
    expect(items[3].href).toBe('/hc/en/collections/3-leaf')
    expect(items[4].href).toBeUndefined()
  })

  it('falls back to just Help Center when the id is unknown', () => {
    const items = buildCategoryBreadcrumbs({
      allCategories: tree,
      categoryId: 'ghost',
    })
    expect(items.map((i) => i.label)).toEqual(['Help Center'])
  })

  it('bails out of a cycle without looping forever', () => {
    // Broken data: a -> b -> a
    const cyclic = [
      { id: 'a', urlId: 1, parentId: 'b', slug: 'a', name: 'A' },
      { id: 'b', urlId: 2, parentId: 'a', slug: 'b', name: 'B' },
    ]
    const items = buildCategoryBreadcrumbs({
      allCategories: cyclic,
      categoryId: 'a',
    })
    // Must terminate; exact shape depends on which direction we walk first,
    // but should include Help Center + at most both nodes
    expect(items.length).toBeLessThanOrEqual(3)
    expect(items[0].label).toBe('Help Center')
  })
})
