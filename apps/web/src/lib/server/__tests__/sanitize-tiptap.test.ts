import { describe, it, expect } from 'vitest'
import { sanitizeTiptapContent } from '../sanitize-tiptap'

// Alias that accepts unknown — used to test garbage input the sanitizer should handle gracefully
const sanitize = sanitizeTiptapContent as (
  input: unknown
) => ReturnType<typeof sanitizeTiptapContent>

describe('sanitizeTiptapContent', () => {
  // ============================================
  // Basic structure
  // ============================================

  it('returns empty doc for invalid input', () => {
    expect(sanitize({ type: 'invalid' })).toEqual({ type: 'doc' })
    expect(sanitize({})).toEqual({ type: 'doc' })
    expect(sanitize(null)).toEqual({ type: 'doc' })
  })

  it('passes through valid simple content unchanged', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.type).toBe('doc')
    expect(result.content).toHaveLength(1)
    expect(result.content![0].type).toBe('paragraph')
    expect(result.content![0].content![0].text).toBe('Hello world')
  })

  it('handles empty doc', () => {
    expect(sanitizeTiptapContent({ type: 'doc' })).toEqual({ type: 'doc' })
  })

  it('handles doc with empty content array', () => {
    expect(sanitizeTiptapContent({ type: 'doc', content: [] })).toEqual({
      type: 'doc',
    })
  })

  // ============================================
  // Node type filtering
  // ============================================

  it('strips unknown node types', () => {
    const input = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep' }] },
        { type: 'script', content: [{ type: 'text', text: 'Remove me' }] },
        { type: 'div', content: [{ type: 'text', text: 'Also remove' }] },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content).toHaveLength(1)
    expect(result.content![0].type).toBe('paragraph')
  })

  it('allows all valid node types', () => {
    const validTypes = [
      'paragraph',
      'heading',
      'text',
      'bulletList',
      'orderedList',
      'listItem',
      'taskList',
      'taskItem',
      'blockquote',
      'codeBlock',
      'image',
      'resizableImage',
      'youtube',
      'horizontalRule',
      'hardBreak',
      'table',
      'tableRow',
      'tableHeader',
      'tableCell',
    ]
    for (const type of validTypes) {
      const input = {
        type: 'doc',
        content: [{ type }],
      }
      const result = sanitizeTiptapContent(input)
      // text nodes require a text field to pass, others pass without content
      if (type === 'text') continue
      expect(result.content?.some((n: Record<string, unknown>) => n.type === type)).toBe(true)
    }
  })

  // ============================================
  // Heading level sanitization
  // ============================================

  it('preserves valid heading levels (1-6)', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const input = {
        type: 'doc',
        content: [{ type: 'heading', attrs: { level } }],
      }
      const result = sanitizeTiptapContent(input)
      expect(result.content![0].attrs!.level).toBe(level)
    }
  })

  it('defaults invalid heading level to 2', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 99 } }],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].attrs!.level).toBe(2)
  })

  it('sanitizes XSS in heading level', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: '1><script>alert(1)</script><h1' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    // NaN from Number() → defaults to 2
    expect(result.content![0].attrs!.level).toBe(2)
  })

  // ============================================
  // Code block language sanitization
  // ============================================

  it('preserves valid code block languages', () => {
    for (const language of ['javascript', 'python', 'c++', 'c-sharp', 'rust']) {
      const input = {
        type: 'doc',
        content: [{ type: 'codeBlock', attrs: { language } }],
      }
      const result = sanitizeTiptapContent(input)
      expect(result.content![0].attrs!.language).toBe(language)
    }
  })

  it('strips XSS in code block language', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'js"><script>alert(1)</script>' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].attrs!.language).toBe('')
  })

  // ============================================
  // Image sanitization
  // ============================================

  it('preserves valid image URLs', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'https://example.com/photo.jpg', alt: 'A photo' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].attrs!.src).toBe('https://example.com/photo.jpg')
    expect(result.content![0].attrs!.alt).toBe('A photo')
  })

  it('blocks javascript: URLs in images', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'javascript:alert(1)' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].attrs!.src).toBe('')
  })

  it('blocks data:image/svg+xml in images', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'data:image/svg+xml,<svg onload="alert(1)"/>',
          },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].attrs!.src).toBe('')
  })

  it('allows safe data:image URLs', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    const input = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src } }],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].attrs!.src).toBe(src)
  })

  it('sanitizes image width/height to safe integers', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'resizableImage',
          attrs: {
            src: 'https://example.com/img.png',
            width: '500"><script>alert(1)</script>',
            height: -100,
          },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    // Invalid width/height removed (default 0 → deleted)
    expect(result.content![0].attrs!.width).toBeUndefined()
    expect(result.content![0].attrs!.height).toBeUndefined()
  })

  // ============================================
  // YouTube sanitization
  // ============================================

  it('preserves valid YouTube attrs', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'youtube',
          attrs: {
            src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            width: 640,
            height: 360,
          },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].attrs!.src).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result.content![0].attrs!.width).toBe(640)
    expect(result.content![0].attrs!.height).toBe(360)
  })

  it('sanitizes XSS in YouTube width/height', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'youtube',
          attrs: {
            src: 'https://www.youtube.com/watch?v=test',
            width: '640" onload="alert(1)',
            height: '360" onerror="alert(2)',
          },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    // NaN → defaults
    expect(result.content![0].attrs!.width).toBe(640)
    expect(result.content![0].attrs!.height).toBe(360)
  })

  // ============================================
  // Mark sanitization
  // ============================================

  it('preserves valid marks', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Bold text',
              marks: [{ type: 'bold' }],
            },
          ],
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].content![0].marks).toEqual([{ type: 'bold' }])
  })

  it('strips unknown mark types', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Test',
              marks: [{ type: 'bold' }, { type: 'onclick' }, { type: 'italic' }],
            },
          ],
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content![0].content![0].marks).toEqual([{ type: 'bold' }, { type: 'italic' }])
  })

  it('sanitizes link mark href', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Click me',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'javascript:alert(1)' },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    // javascript: URL → link mark removed entirely
    expect(result.content![0].content![0].marks).toBeUndefined()
  })

  it('preserves valid link marks with safe attrs', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Visit',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://example.com' },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const mark = result.content![0].content![0].marks![0]
    expect(mark.type).toBe('link')
    expect(mark.attrs!.href).toBe('https://example.com/')
    expect(mark.attrs!.target).toBe('_blank')
    expect(mark.attrs!.rel).toBe('noopener noreferrer')
  })

  // ============================================
  // Attribute stripping
  // ============================================

  it('strips unknown attributes from nodes', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { onclick: 'alert(1)', style: 'color:red', class: 'evil' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    // Paragraph gets no attrs
    expect(result.content![0].attrs).toBeUndefined()
  })

  // ============================================
  // Depth protection
  // ============================================

  it('stops at max depth (20)', () => {
    // Build a deeply nested structure
    let node: Record<string, unknown> = { type: 'text', text: 'deep' }
    for (let i = 0; i < 25; i++) {
      node = { type: 'paragraph', content: [node] }
    }
    const input = { type: 'doc', content: [node] }
    const result = sanitizeTiptapContent(input)
    // Should have content but truncated at depth 20
    expect(result.type).toBe('doc')

    // Verify the deepest text is cut off
    let current: Record<string, unknown> = result
    let depth = 0
    while ((current?.content as Record<string, unknown>[])?.[0]) {
      current = (current.content as Record<string, unknown>[])[0]
      depth++
    }
    // Should not reach the full 26 levels
    expect(depth).toBeLessThanOrEqual(21)
  })

  // ============================================
  // Complex content
  // ============================================

  it('handles complex nested content correctly', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Features' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Bold feature',
                      marks: [{ type: 'bold' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const x = 1' }],
        },
        { type: 'horizontalRule' },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'A quote with a ',
                },
                {
                  type: 'text',
                  text: 'link',
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: 'https://example.com' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    expect(result.content).toHaveLength(5)
    expect(result.content![0].type).toBe('heading')
    expect(result.content![0].attrs!.level).toBe(2)
    expect(result.content![1].type).toBe('bulletList')
    expect(result.content![2].type).toBe('codeBlock')
    expect(result.content![2].attrs!.language).toBe('typescript')
    expect(result.content![3].type).toBe('horizontalRule')
    expect(result.content![4].type).toBe('blockquote')
  })
})
