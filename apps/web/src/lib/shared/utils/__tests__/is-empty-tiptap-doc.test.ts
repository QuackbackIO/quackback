import { describe, it, expect } from 'vitest'
import { isEmptyTiptapDoc } from '../is-empty-tiptap-doc'
import type { TiptapContent } from '@/lib/shared/db-types'

describe('isEmptyTiptapDoc', () => {
  it('treats undefined as empty', () => {
    expect(isEmptyTiptapDoc(undefined)).toBe(true)
  })

  it('treats a doc with no content as empty', () => {
    expect(isEmptyTiptapDoc({ type: 'doc' })).toBe(true)
  })

  it('treats a single empty paragraph as empty', () => {
    expect(isEmptyTiptapDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true)
  })

  it('treats a paragraph with only whitespace as empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '   ' }],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(true)
  })

  it('treats a paragraph with real text as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('treats a doc with an image node as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://example.com/x.png' } }],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('treats a doc with a heading as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Welcome' }],
        },
      ],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })

  it('treats a doc with a horizontalRule as non-empty', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [{ type: 'horizontalRule' }],
    }
    expect(isEmptyTiptapDoc(doc)).toBe(false)
  })
})
