/**
 * Tests for Help Center shared schemas.
 *
 * Covers validation for category and article create/update schemas.
 */

import { describe, it, expect } from 'vitest'
import {
  createCategorySchema,
  updateCategorySchema,
  createArticleSchema,
  updateArticleSchema,
  listArticlesSchema,
  articleFeedbackSchema,
} from '../help-center'

describe('createCategorySchema', () => {
  it('accepts valid input', () => {
    const result = createCategorySchema.safeParse({
      name: 'Getting Started',
    })
    expect(result.success).toBe(true)
  })

  it('accepts input with all optional fields', () => {
    const result = createCategorySchema.safeParse({
      name: 'Advanced',
      slug: 'advanced-topics',
      description: 'Advanced guides',
      isPublic: false,
      position: 5,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = createCategorySchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects name over 200 chars', () => {
    const result = createCategorySchema.safeParse({ name: 'a'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('rejects missing name', () => {
    const result = createCategorySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts emoji unicode as icon', () => {
    const result = createCategorySchema.safeParse({
      name: 'Billing',
      icon: '💰',
      isPublic: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.icon).toBe('💰')
    }
  })

  it('accepts full CategoryFormDialog payload', () => {
    const result = createCategorySchema.safeParse({
      name: 'Getting Started',
      description: 'Learn the basics',
      icon: '📚',
      isPublic: true,
    })
    expect(result.success).toBe(true)
  })

  it('accepts isPublic false', () => {
    const result = createCategorySchema.safeParse({
      name: 'Internal Docs',
      isPublic: false,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isPublic).toBe(false)
    }
  })
})

describe('updateCategorySchema', () => {
  it('accepts valid update with id', () => {
    const result = updateCategorySchema.safeParse({
      id: 'category_1',
      name: 'Updated Name',
    })
    expect(result.success).toBe(true)
  })

  it('accepts nullable description', () => {
    const result = updateCategorySchema.safeParse({
      id: 'category_1',
      description: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing id', () => {
    const result = updateCategorySchema.safeParse({ name: 'Name' })
    expect(result.success).toBe(false)
  })

  it('accepts position update for drag reorder', () => {
    const result = updateCategorySchema.safeParse({
      id: 'category_1',
      position: 3,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.position).toBe(3)
    }
  })

  it('accepts full CategoryFormDialog edit payload', () => {
    const result = updateCategorySchema.safeParse({
      id: 'category_1',
      name: 'Updated Name',
      description: 'Updated description',
      icon: '🔧',
      isPublic: false,
    })
    expect(result.success).toBe(true)
  })

  it('accepts emoji icon update', () => {
    const result = updateCategorySchema.safeParse({
      id: 'category_1',
      icon: '🚀',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.icon).toBe('🚀')
    }
  })
})

describe('createArticleSchema', () => {
  it('accepts valid input', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'category_1',
      title: 'How to Get Started',
      content: 'Follow these steps...',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty title', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'category_1',
      title: '',
      content: 'Content',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty content', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'category_1',
      title: 'Title',
      content: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing categoryId', () => {
    const result = createArticleSchema.safeParse({
      title: 'Title',
      content: 'Content',
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional slug', () => {
    const result = createArticleSchema.safeParse({
      categoryId: 'category_1',
      title: 'Title',
      content: 'Content',
      slug: 'custom-slug',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.slug).toBe('custom-slug')
    }
  })
})

describe('updateArticleSchema', () => {
  it('accepts partial update', () => {
    const result = updateArticleSchema.safeParse({
      id: 'article_1',
      title: 'Updated Title',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing id', () => {
    const result = updateArticleSchema.safeParse({ title: 'Title' })
    expect(result.success).toBe(false)
  })
})

describe('listArticlesSchema', () => {
  it('accepts empty object', () => {
    const result = listArticlesSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts all filters', () => {
    const result = listArticlesSchema.safeParse({
      categoryId: 'category_1',
      status: 'published',
      search: 'getting started',
      cursor: 'some_cursor',
      limit: 50,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid status', () => {
    const result = listArticlesSchema.safeParse({ status: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('rejects limit over 100', () => {
    const result = listArticlesSchema.safeParse({ limit: 101 })
    expect(result.success).toBe(false)
  })

  it('rejects negative limit', () => {
    const result = listArticlesSchema.safeParse({ limit: -1 })
    expect(result.success).toBe(false)
  })
})

describe('articleFeedbackSchema', () => {
  it('accepts valid feedback', () => {
    const result = articleFeedbackSchema.safeParse({
      articleId: 'article_1',
      helpful: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing articleId', () => {
    const result = articleFeedbackSchema.safeParse({ helpful: true })
    expect(result.success).toBe(false)
  })

  it('rejects missing helpful', () => {
    const result = articleFeedbackSchema.safeParse({ articleId: 'article_1' })
    expect(result.success).toBe(false)
  })

  it('rejects non-boolean helpful', () => {
    const result = articleFeedbackSchema.safeParse({
      articleId: 'article_1',
      helpful: 'yes',
    })
    expect(result.success).toBe(false)
  })
})
