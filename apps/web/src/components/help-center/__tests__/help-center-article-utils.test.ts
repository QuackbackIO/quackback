import { describe, it, expect } from 'vitest'
import { extractHeadings, computePrevNext } from '../help-center-article-utils'
import type { JSONContent } from '@tiptap/core'
import { generateContentHTML } from '@/lib/shared/content-html'

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
  id: string
  urlId: number
  slug: string
  title: string
}

describe('computePrevNext', () => {
  const articles: ArticleLike[] = [
    { id: 'a1', urlId: 1, slug: 'first', title: 'First Article' },
    { id: 'a2', urlId: 2, slug: 'second', title: 'Second Article' },
    { id: 'a3', urlId: 3, slug: 'third', title: 'Third Article' },
  ]

  it('returns prev and next for a middle article', () => {
    const result = computePrevNext(articles, 'second')
    expect(result).toEqual({
      prev: articles[0],
      next: articles[2],
    })
  })

  it('returns null prev for the first article', () => {
    const result = computePrevNext(articles, 'first')
    expect(result).toEqual({
      prev: null,
      next: articles[1],
    })
  })

  it('returns null next for the last article', () => {
    const result = computePrevNext(articles, 'third')
    expect(result).toEqual({
      prev: articles[1],
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
    const result = computePrevNext([{ id: 'a1', urlId: 1, slug: 'only', title: 'Only' }], 'only')
    expect(result).toEqual({ prev: null, next: null })
  })
})

describe('extractHeadings with repeated heading text', () => {
  const h = (level: number, text: string) => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  })
  const doc = {
    type: 'doc',
    content: [
      h(2, 'iOS'),
      h(3, 'Configuration options'),
      h(2, 'Android'),
      h(3, 'Configuration options'),
      h(3, 'Configuration options'),
    ],
  }

  it('gives each repeated heading its own id', () => {
    expect(extractHeadings(doc).map((heading) => heading.id)).toEqual([
      'ios',
      'configuration-options',
      'android',
      'configuration-options-1',
      'configuration-options-2',
    ])
  })

  it('matches the ids the article HTML renders, so the table of contents finds every heading', () => {
    const html = generateContentHTML(doc as JSONContent)
    const rendered = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1])
    expect(extractHeadings(doc).map((heading) => heading.id)).toEqual(rendered)
  })

  it('counts headings at other levels so ids still line up with the HTML', () => {
    const mixed = {
      type: 'doc',
      content: [h(4, 'Notes'), h(2, 'Notes'), h(3, 'Notes')],
    }
    const html = generateContentHTML(mixed as JSONContent)
    const rendered = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1])
    expect(rendered).toEqual(['notes', 'notes-1', 'notes-2'])
    expect(extractHeadings(mixed).map((heading) => heading.id)).toEqual(['notes-1', 'notes-2'])
  })

  const setupDoc = {
    type: 'doc',
    content: [h(2, 'Setup'), h(2, 'Setup'), h(2, 'Setup-1')],
  }

  it('keeps a unique heading natural anchor when repeats precede it', () => {
    expect(extractHeadings(setupDoc).map((heading) => heading.id)).toEqual([
      'setup',
      'setup-2',
      'setup-1',
    ])
  })

  it('renders the same anchors in the article HTML for that case', () => {
    const html = generateContentHTML(setupDoc as JSONContent)
    const rendered = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1])
    expect(rendered).toEqual(['setup', 'setup-2', 'setup-1'])
    expect(extractHeadings(setupDoc).map((heading) => heading.id)).toEqual(rendered)
  })
})
