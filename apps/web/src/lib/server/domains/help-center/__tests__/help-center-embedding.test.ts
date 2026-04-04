import { describe, it, expect } from 'vitest'
import { formatArticleText } from '../help-center-embedding.service'

describe('formatArticleText', () => {
  it('combines title (repeated) and content', () => {
    const result = formatArticleText('My Title', 'Some content here')
    expect(result).toBe('My Title\n\nMy Title\n\nSome content here')
  })

  it('includes category name when provided', () => {
    const result = formatArticleText('My Title', 'Content', 'Getting Started')
    expect(result).toBe('My Title\n\nMy Title\n\nContent\n\nCategory: Getting Started')
  })

  it('omits category section when not provided', () => {
    const result = formatArticleText('Title', 'Content')
    expect(result).not.toContain('Category:')
  })

  it('handles empty content gracefully', () => {
    const result = formatArticleText('Title', '')
    expect(result).toBe('Title\n\nTitle\n\n')
  })

  it('truncates output to 8000 characters', () => {
    const longContent = 'x'.repeat(10000)
    const result = formatArticleText('Title', longContent)
    expect(result.length).toBe(8000)
  })

  it('does not truncate when under 8000 characters', () => {
    const content = 'Short content'
    const result = formatArticleText('Title', content)
    expect(result.length).toBeLessThan(8000)
    expect(result).toContain(content)
  })

  it('omits category when categoryName is undefined', () => {
    const result = formatArticleText('Title', 'Body', undefined)
    expect(result).toBe('Title\n\nTitle\n\nBody')
  })

  it('omits category when categoryName is empty string', () => {
    // Empty string is falsy, so it should be omitted
    const result = formatArticleText('Title', 'Body', '')
    expect(result).not.toContain('Category:')
  })
})
