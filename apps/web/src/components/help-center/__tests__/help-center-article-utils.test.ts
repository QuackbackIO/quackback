import { describe, it, expect } from 'vitest'
import { extractHeadings, computePrevNext } from '../help-center-article-utils'

// =============================================================================
// extractHeadings
// =============================================================================

describe('extractHeadings', () => {
  it('returns empty array for null/undefined input', () => {
    expect(extractHeadings(null)).toEqual([])
    expect(extractHeadings(undefined)).toEqual([])
  })

  it('returns empty array for content with no headings', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Just a paragraph' }],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([])
  })

  it('extracts H2 headings', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Getting Started' }],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([
      { id: 'getting-started', text: 'Getting Started', level: 2 },
    ])
  })

  it('extracts H3 headings', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Installation' }],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([
      { id: 'installation', text: 'Installation', level: 3 },
    ])
  })

  it('ignores H1 and H4+ headings', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Section' }],
        },
        {
          type: 'heading',
          attrs: { level: 4 },
          content: [{ type: 'text', text: 'Subsub' }],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([{ id: 'section', text: 'Section', level: 2 }])
  })

  it('generates slug-based ids from heading text', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'How to Get Started!' }],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([
      { id: 'how-to-get-started', text: 'How to Get Started!', level: 2 },
    ])
  })

  it('handles headings with multiple text nodes', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'Bold ' },
            { type: 'text', text: 'and Normal' },
          ],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([
      { id: 'bold-and-normal', text: 'Bold and Normal', level: 2 },
    ])
  })

  it('handles headings with no content array', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([])
  })

  it('trims leading and trailing hyphens from slug', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '---Intro---' }],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([{ id: 'intro', text: '---Intro---', level: 2 }])
  })

  it('extracts multiple headings in order', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Overview' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Some text...' }],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Details' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Conclusion' }],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([
      { id: 'overview', text: 'Overview', level: 2 },
      { id: 'details', text: 'Details', level: 3 },
      { id: 'conclusion', text: 'Conclusion', level: 2 },
    ])
  })

  it('returns empty array when content.content is missing', () => {
    expect(extractHeadings({ type: 'doc' })).toEqual([])
  })

  it('handles special characters in heading text', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'API v2.0 & SDK' }],
        },
      ],
    }
    expect(extractHeadings(content)).toEqual([
      { id: 'api-v2-0-sdk', text: 'API v2.0 & SDK', level: 2 },
    ])
  })
})

// =============================================================================
// computePrevNext
// =============================================================================

interface ArticleLike {
  slug: string
  title: string
}

describe('computePrevNext', () => {
  const articles: ArticleLike[] = [
    { slug: 'first', title: 'First Article' },
    { slug: 'second', title: 'Second Article' },
    { slug: 'third', title: 'Third Article' },
  ]

  it('returns prev and next for a middle article', () => {
    const result = computePrevNext(articles, 'second')
    expect(result).toEqual({
      prev: { slug: 'first', title: 'First Article' },
      next: { slug: 'third', title: 'Third Article' },
    })
  })

  it('returns null prev for the first article', () => {
    const result = computePrevNext(articles, 'first')
    expect(result).toEqual({
      prev: null,
      next: { slug: 'second', title: 'Second Article' },
    })
  })

  it('returns null next for the last article', () => {
    const result = computePrevNext(articles, 'third')
    expect(result).toEqual({
      prev: { slug: 'second', title: 'Second Article' },
      next: null,
    })
  })

  it('returns both null when the article is not found', () => {
    const result = computePrevNext(articles, 'nonexistent')
    expect(result).toEqual({ prev: null, next: null })
  })

  it('returns both null for an empty list', () => {
    const result = computePrevNext([], 'anything')
    expect(result).toEqual({ prev: null, next: null })
  })

  it('returns both null for a single article', () => {
    const result = computePrevNext([{ slug: 'only', title: 'Only' }], 'only')
    expect(result).toEqual({ prev: null, next: null })
  })
})
