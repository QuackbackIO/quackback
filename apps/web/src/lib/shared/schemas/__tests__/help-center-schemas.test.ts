import { describe, it, expect } from 'vitest'
import {
  updateHelpCenterConfigSchema,
  updateHelpCenterSeoSchema,
  createCategorySchema,
  updateCategorySchema,
  createArticleSchema,
  updateArticleSchema,
} from '../help-center'

describe('updateHelpCenterConfigSchema', () => {
  it('should accept empty object (all optional)', () => {
    const result = updateHelpCenterConfigSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('should accept enabled boolean', () => {
    const result = updateHelpCenterConfigSchema.safeParse({ enabled: true })
    expect(result.success).toBe(true)
    expect(result.data?.enabled).toBe(true)
  })

  it('should accept homepageTitle', () => {
    const result = updateHelpCenterConfigSchema.safeParse({ homepageTitle: 'Help Center' })
    expect(result.success).toBe(true)
  })

  it('should reject empty homepageTitle', () => {
    const result = updateHelpCenterConfigSchema.safeParse({ homepageTitle: '' })
    expect(result.success).toBe(false)
  })

  it('should reject homepageTitle over 200 chars', () => {
    const result = updateHelpCenterConfigSchema.safeParse({ homepageTitle: 'a'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('should accept homepageDescription', () => {
    const result = updateHelpCenterConfigSchema.safeParse({
      homepageDescription: 'Browse our docs',
    })
    expect(result.success).toBe(true)
  })

  it('should reject homepageDescription over 500 chars', () => {
    const result = updateHelpCenterConfigSchema.safeParse({
      homepageDescription: 'a'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('should accept all fields together', () => {
    const result = updateHelpCenterConfigSchema.safeParse({
      enabled: true,
      homepageTitle: 'Get Help',
      homepageDescription: 'Browse our docs',
    })
    expect(result.success).toBe(true)
  })
})

describe('updateHelpCenterSeoSchema', () => {
  it('should accept empty object (all optional)', () => {
    const result = updateHelpCenterSeoSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('should accept metaDescription', () => {
    const result = updateHelpCenterSeoSchema.safeParse({ metaDescription: 'Help center for Acme' })
    expect(result.success).toBe(true)
  })

  it('should reject metaDescription over 500 chars', () => {
    const result = updateHelpCenterSeoSchema.safeParse({ metaDescription: 'a'.repeat(501) })
    expect(result.success).toBe(false)
  })

  it('should accept sitemapEnabled boolean', () => {
    const result = updateHelpCenterSeoSchema.safeParse({ sitemapEnabled: false })
    expect(result.success).toBe(true)
    expect(result.data?.sitemapEnabled).toBe(false)
  })

  it('should accept structuredDataEnabled boolean', () => {
    const result = updateHelpCenterSeoSchema.safeParse({ structuredDataEnabled: true })
    expect(result.success).toBe(true)
  })

  it('should accept all fields together', () => {
    const result = updateHelpCenterSeoSchema.safeParse({
      metaDescription: 'Our help center',
      sitemapEnabled: true,
      structuredDataEnabled: false,
    })
    expect(result.success).toBe(true)
  })
})

describe('createCategorySchema (updated fields)', () => {
  it('should accept parentId', () => {
    const result = createCategorySchema.safeParse({
      name: 'Getting Started',
      parentId: 'hc_cat_123',
    })
    expect(result.success).toBe(true)
    expect(result.data?.parentId).toBe('hc_cat_123')
  })

  it('should accept parentId null', () => {
    const result = createCategorySchema.safeParse({
      name: 'Getting Started',
      parentId: null,
    })
    expect(result.success).toBe(true)
    expect(result.data?.parentId).toBeNull()
  })

  it('should accept icon', () => {
    const result = createCategorySchema.safeParse({
      name: 'Getting Started',
      icon: 'book',
    })
    expect(result.success).toBe(true)
    expect(result.data?.icon).toBe('book')
  })

  it('should accept icon null', () => {
    const result = createCategorySchema.safeParse({
      name: 'Getting Started',
      icon: null,
    })
    expect(result.success).toBe(true)
    expect(result.data?.icon).toBeNull()
  })

  it('should reject icon over 50 chars', () => {
    const result = createCategorySchema.safeParse({
      name: 'Getting Started',
      icon: 'a'.repeat(51),
    })
    expect(result.success).toBe(false)
  })

  it('should still work without new fields', () => {
    const result = createCategorySchema.safeParse({
      name: 'Getting Started',
    })
    expect(result.success).toBe(true)
  })
})

describe('updateCategorySchema (updated fields)', () => {
  it('should accept parentId', () => {
    const result = updateCategorySchema.safeParse({
      id: 'hc_cat_123',
      parentId: 'hc_cat_parent',
    })
    expect(result.success).toBe(true)
    expect(result.data?.parentId).toBe('hc_cat_parent')
  })

  it('should accept parentId null', () => {
    const result = updateCategorySchema.safeParse({
      id: 'hc_cat_123',
      parentId: null,
    })
    expect(result.success).toBe(true)
    expect(result.data?.parentId).toBeNull()
  })

  it('should accept icon', () => {
    const result = updateCategorySchema.safeParse({
      id: 'hc_cat_123',
      icon: 'star',
    })
    expect(result.success).toBe(true)
  })

  it('should accept icon null', () => {
    const result = updateCategorySchema.safeParse({
      id: 'hc_cat_123',
      icon: null,
    })
    expect(result.success).toBe(true)
    expect(result.data?.icon).toBeNull()
  })
})

describe('createArticleSchema (updated fields)', () => {
  it('should accept position', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'hc_cat_123',
      title: 'Test Article',
      content: 'Some content',
      position: 5,
    })
    expect(result.success).toBe(true)
    expect(result.data?.position).toBe(5)
  })

  it('should reject non-integer position', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'hc_cat_123',
      title: 'Test Article',
      content: 'Some content',
      position: 1.5,
    })
    expect(result.success).toBe(false)
  })

  it('should accept description', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'hc_cat_123',
      title: 'Test Article',
      content: 'Some content',
      description: 'A short summary',
    })
    expect(result.success).toBe(true)
    expect(result.data?.description).toBe('A short summary')
  })

  it('should reject description over 300 chars', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'hc_cat_123',
      title: 'Test Article',
      content: 'Some content',
      description: 'a'.repeat(301),
    })
    expect(result.success).toBe(false)
  })

  it('should still work without new fields', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'hc_cat_123',
      title: 'Test Article',
      content: 'Some content',
    })
    expect(result.success).toBe(true)
  })
})

describe('updateArticleSchema (updated fields)', () => {
  it('should accept position', () => {
    const result = updateArticleSchema.safeParse({
      id: 'hc_art_123',
      position: 3,
    })
    expect(result.success).toBe(true)
    expect(result.data?.position).toBe(3)
  })

  it('should accept description', () => {
    const result = updateArticleSchema.safeParse({
      id: 'hc_art_123',
      description: 'Updated summary',
    })
    expect(result.success).toBe(true)
    expect(result.data?.description).toBe('Updated summary')
  })

  it('should reject description over 300 chars', () => {
    const result = updateArticleSchema.safeParse({
      id: 'hc_art_123',
      description: 'a'.repeat(301),
    })
    expect(result.success).toBe(false)
  })
})
