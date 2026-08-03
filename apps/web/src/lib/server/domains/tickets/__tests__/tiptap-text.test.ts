/**
 * tiptap-text — quick smoke tests for the plain-text extractor.
 */
import { describe, it, expect } from 'vitest'
import { tiptapToPlainText } from '../tiptap-text'

describe('tiptapToPlainText', () => {
  it('returns empty string for null/empty input', () => {
    expect(tiptapToPlainText(null)).toBe('')
    expect(tiptapToPlainText({ type: 'doc' } as never)).toBe('')
  })

  it('concatenates text nodes across paragraphs with blank lines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'World' }] },
      ],
    }
    expect(tiptapToPlainText(doc as never)).toBe('Hello\n\nWorld')
  })

  it('handles nested marks and inline structures', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    expect(tiptapToPlainText(doc as never)).toBe('plain bold')
  })
})
