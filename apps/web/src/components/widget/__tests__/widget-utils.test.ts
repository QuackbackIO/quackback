import { describe, it, expect } from 'vitest'
import { truncateContent } from '../widget-changelog'
import { countLiveComments } from '../widget-post-detail'

describe('truncateContent', () => {
  it('returns short content unchanged', () => {
    expect(truncateContent('Hello world')).toBe('Hello world')
  })

  it('truncates long content with ellipsis', () => {
    const long = 'a'.repeat(200)
    const result = truncateContent(long, 120)
    expect(result.length).toBeLessThanOrEqual(123) // 120 + "..."
    expect(result.endsWith('...')).toBe(true)
  })

  it('strips markdown heading markers', () => {
    expect(truncateContent('# Heading\nContent')).toBe('Heading Content')
    expect(truncateContent('## Sub heading\nContent')).toBe('Sub heading Content')
    expect(truncateContent('### H3\nContent')).toBe('H3 Content')
  })

  it('strips bold markdown', () => {
    expect(truncateContent('This is **bold** text')).toBe('This is bold text')
  })

  it('strips italic markdown', () => {
    expect(truncateContent('This is *italic* text')).toBe('This is italic text')
  })

  it('strips inline code', () => {
    expect(truncateContent('Use `console.log` here')).toBe('Use console.log here')
  })

  it('strips markdown links', () => {
    expect(truncateContent('Click [here](https://example.com) now')).toBe('Click here now')
  })

  it('strips list markers', () => {
    expect(truncateContent('- Item one\n- Item two')).toBe('Item one Item two')
    expect(truncateContent('* Star item')).toBe('Star item')
  })

  it('collapses newlines to spaces', () => {
    expect(truncateContent('Line 1\n\nLine 2\nLine 3')).toBe('Line 1 Line 2 Line 3')
  })

  it('trims whitespace', () => {
    expect(truncateContent('  spaced  ')).toBe('spaced')
  })

  it('handles empty string', () => {
    expect(truncateContent('')).toBe('')
  })

  it('respects custom maxLength', () => {
    const result = truncateContent('a'.repeat(50), 10)
    expect(result).toBe('a'.repeat(10) + '...')
  })

  it('handles complex markdown combination', () => {
    const input = '## Feature\n\n**Bold** and *italic* with `code` and [link](url)\n- List item'
    const result = truncateContent(input)
    expect(result).toBe('Feature Bold and italic with code and link List item')
  })
})

describe('countLiveComments', () => {
  it('returns 0 for empty array', () => {
    expect(countLiveComments([])).toBe(0)
  })

  it('counts non-deleted comments', () => {
    const comments = [
      { deletedAt: null, replies: [] },
      { deletedAt: null, replies: [] },
      { deletedAt: null, replies: [] },
    ]
    expect(countLiveComments(comments)).toBe(3)
  })

  it('excludes deleted comments', () => {
    const comments = [
      { deletedAt: null, replies: [] },
      { deletedAt: '2024-01-01', replies: [] },
      { deletedAt: null, replies: [] },
    ]
    expect(countLiveComments(comments)).toBe(2)
  })

  it('counts nested replies recursively', () => {
    const comments = [
      {
        deletedAt: null,
        replies: [
          { deletedAt: null, replies: [] },
          { deletedAt: null, replies: [{ deletedAt: null, replies: [] }] },
        ],
      },
    ]
    expect(countLiveComments(comments)).toBe(4) // 1 root + 2 replies + 1 nested
  })

  it('excludes deleted replies from count', () => {
    const comments = [
      {
        deletedAt: null,
        replies: [
          { deletedAt: null, replies: [] },
          { deletedAt: new Date(), replies: [] },
        ],
      },
    ]
    expect(countLiveComments(comments)).toBe(2) // 1 root + 1 live reply
  })

  it('handles deleted parent with live replies', () => {
    const comments = [
      {
        deletedAt: '2024-01-01',
        replies: [{ deletedAt: null, replies: [] }],
      },
    ]
    expect(countLiveComments(comments)).toBe(1) // only the reply
  })

  it('handles deeply nested structure', () => {
    const comments = [
      {
        deletedAt: null,
        replies: [
          {
            deletedAt: null,
            replies: [
              {
                deletedAt: null,
                replies: [{ deletedAt: null, replies: [] }],
              },
            ],
          },
        ],
      },
    ]
    expect(countLiveComments(comments)).toBe(4)
  })
})
