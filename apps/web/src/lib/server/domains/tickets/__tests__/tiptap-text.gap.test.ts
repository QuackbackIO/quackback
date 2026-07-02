/**
 * tiptap-text — gap tests covering the falsy-child guard in walk().
 */
import { describe, it, expect } from 'vitest'
import { tiptapToPlainText } from '../tiptap-text'

describe('tiptapToPlainText gap', () => {
  it('skips null/undefined children inside a content array', () => {
    const doc = {
      type: 'doc',
      content: [
        null,
        undefined,
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }, null] },
      ],
    }
    expect(tiptapToPlainText(doc as never)).toBe('Hi')
  })
})
