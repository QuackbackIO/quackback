import { describe, it, expect, vi } from 'vitest'

// The sanitizer now resolves `chatImage` src against the app base (trusted-upload
// check), which reads `config` — provide a valid base (the full env isn't loaded
// in unit tests). Mirrors the conversation-send-service test's config mock.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
}))

import { sanitizeTiptapContent } from '../sanitize-tiptap'
import type { TiptapContent } from '@/lib/server/db'

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
      expect(result.content?.some((n) => n.type === type)).toBe(true)
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
    let current: TiptapContent = result
    let depth = 0
    while (current?.content?.[0]) {
      current = current.content[0]
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

  it('preserves emoji nodes and their name/emoji attrs', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            {
              type: 'emoji',
              attrs: {
                name: 'smile',
                emoji: '😄',
                // Junk attrs that should be dropped
                fallbackImage: 'https://evil/x.png',
                shortcodes: ['smile'],
              },
            },
            { type: 'text', text: '!' },
          ],
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const paragraph = result.content![0]
    const emojiNode = paragraph.content!.find((n) => n.type === 'emoji')
    expect(emojiNode).toBeDefined()
    expect(emojiNode!.attrs).toEqual({ name: 'smile', emoji: '😄' })
  })

  it('accepts emoji-only nodes when name is missing (Unicode char is enough to render)', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'emoji', attrs: { emoji: '😄' } }],
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const paragraph = result.content![0]
    const emojiNode = paragraph.content!.find((n) => n.type === 'emoji')
    expect(emojiNode!.attrs).toEqual({ emoji: '😄' })
  })

  // ============================================
  // Quackback link embed sanitization
  // ============================================

  // Real, round-trip-valid TypeIDs (same fixtures as the parse-embed-url test).
  const EMBED_POST_ID = 'post_01ktjwt5tyf6br9mw521h13n6n'
  const EMBED_CHANGELOG_ID = 'changelog_01ktjwt5tyf6br9mwcz1vskk44'

  it('preserves a valid post embed node with kind/id attrs', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: EMBED_POST_ID } }],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'quackbackEmbed')
    expect(node).toBeDefined()
    expect(node!.attrs).toEqual({ kind: 'post', id: EMBED_POST_ID })
  })

  it('preserves a valid changelog embed node with kind/id attrs', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'changelog', id: EMBED_CHANGELOG_ID } }],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'quackbackEmbed')
    expect(node).toBeDefined()
    expect(node!.attrs).toEqual({ kind: 'changelog', id: EMBED_CHANGELOG_ID })
  })

  it('drops unknown attrs from a valid embed node', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'quackbackEmbed',
          attrs: { kind: 'post', id: EMBED_POST_ID, onclick: 'alert(1)', class: 'evil' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'quackbackEmbed')
    expect(node!.attrs).toEqual({ kind: 'post', id: EMBED_POST_ID })
  })

  it('neutralizes an embed with an invalid kind (strips attrs so it cannot render)', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'board', id: EMBED_POST_ID } }],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content?.find((n) => n.type === 'quackbackEmbed')
    // Atom node may survive in the schema, but with no attrs the serializer
    // renders nothing — a malformed embed can never display.
    expect(node?.attrs).toBeUndefined()
  })

  it('neutralizes an embed whose id is not a valid TypeID', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: 'not-a-real-id' } }],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content?.find((n) => n.type === 'quackbackEmbed')
    expect(node?.attrs).toBeUndefined()
  })

  it('neutralizes an embed whose id is a TypeID of the wrong kind', () => {
    // A changelog id labelled kind:'post' must not survive.
    const input = {
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: EMBED_CHANGELOG_ID } }],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content?.find((n) => n.type === 'quackbackEmbed')
    expect(node?.attrs).toBeUndefined()
  })

  it('preserves a valid article embed node (slug as id)', () => {
    const input = {
      type: 'doc',
      content: [
        { type: 'quackbackEmbed', attrs: { kind: 'article', id: 'how-to-reset-password' } },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'quackbackEmbed')
    expect(node).toBeDefined()
    expect(node!.attrs).toEqual({ kind: 'article', id: 'how-to-reset-password' })
  })

  it('neutralizes an article embed with an invalid slug (XSS attempt)', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'quackbackEmbed',
          attrs: { kind: 'article', id: '"><script>alert(1)</script>' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content?.find((n) => n.type === 'quackbackEmbed')
    expect(node?.attrs).toBeUndefined()
  })

  it('neutralizes an article embed with an empty slug', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'article', id: '' } }],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content?.find((n) => n.type === 'quackbackEmbed')
    expect(node?.attrs).toBeUndefined()
  })

  // ============================================
  // Inline conversation image sanitization
  // ============================================

  it('preserves a chatImage with a same-origin upload src', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'chatImage',
          attrs: { src: '/api/storage/chat-images/photo.png', alt: 'A screenshot' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'chatImage')
    expect(node).toBeDefined()
    expect(node!.attrs!.src).toBe('/api/storage/chat-images/photo.png')
    expect(node!.attrs!.alt).toBe('A screenshot')
  })

  it('strips an external (non-upload) chatImage src — no third-party tracking pixel', () => {
    const input = {
      type: 'doc',
      content: [
        { type: 'chatImage', attrs: { src: 'https://evil.example.com/track.gif', alt: 'x' } },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'chatImage')
    expect(node!.attrs!.src).toBe('')
  })

  it('strips a javascript: src on a chatImage (node neutralized)', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'chatImage', attrs: { src: 'javascript:alert(1)', alt: 'x' } }],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'chatImage')
    expect(node!.attrs!.src).toBe('')
  })

  // ============================================
  // restrictImagesToTrustedOrigins — the chatImage guard, opted into for
  // image/resizableImage on visitor-authored content
  // ============================================

  it('keeps an external resizableImage src by default (agent-authored content)', () => {
    const input = {
      type: 'doc',
      content: [
        { type: 'resizableImage', attrs: { src: 'https://cdn.example.com/shot.png', alt: 'x' } },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'resizableImage')
    expect(node!.attrs!.src).toBe('https://cdn.example.com/shot.png')
  })

  it('strips an external resizableImage src under restrictImagesToTrustedOrigins', () => {
    const input = {
      type: 'doc',
      content: [
        { type: 'resizableImage', attrs: { src: 'https://evil.example.com/track.gif', alt: 'x' } },
        { type: 'image', attrs: { src: 'https://evil.example.com/pixel.png', alt: 'y' } },
      ],
    }
    const result = sanitizeTiptapContent(input, { restrictImagesToTrustedOrigins: true })
    const resizable = result.content!.find((n) => n.type === 'resizableImage')
    const image = result.content!.find((n) => n.type === 'image')
    expect(resizable!.attrs!.src).toBe('')
    expect(image!.attrs!.src).toBe('')
  })

  it('keeps a same-origin upload resizableImage src under restrictImagesToTrustedOrigins', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'resizableImage',
          attrs: {
            src: '/api/storage/chat-images/photo.png',
            alt: 'ok',
            width: 320,
            'data-keep-ratio': true,
          },
        },
      ],
    }
    const result = sanitizeTiptapContent(input, { restrictImagesToTrustedOrigins: true })
    const node = result.content!.find((n) => n.type === 'resizableImage')
    expect(node!.attrs!.src).toBe('/api/storage/chat-images/photo.png')
    expect(node!.attrs!.width).toBe(320)
    expect(node!.attrs!['data-keep-ratio']).toBe(true)
  })

  it('restricts images inside nested structures too (list item)', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'see:' }],
                },
                {
                  type: 'resizableImage',
                  attrs: { src: 'https://evil.example.com/deep.gif', alt: 'x' },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = sanitizeTiptapContent(input, { restrictImagesToTrustedOrigins: true })
    const list = result.content!.find((n) => n.type === 'bulletList')
    const img = list!.content![0].content!.find((n) => n.type === 'resizableImage')
    expect(img!.attrs!.src).toBe('')
  })

  it('strips a data:image/svg+xml src on a chatImage', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'chatImage',
          attrs: { src: 'data:image/svg+xml,<svg onload="alert(1)"/>' },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'chatImage')
    expect(node!.attrs!.src).toBe('')
  })

  it('neutralizes a chatImage with an empty src', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'chatImage', attrs: { src: '', alt: 'orphan' } }],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'chatImage')
    // Empty src → src/alt cleared so the serializer renders nothing.
    expect(node!.attrs!.src).toBe('')
    expect(node!.attrs!.alt).toBe('')
  })

  it('caps a hostile chatImage alt and drops unknown attrs', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'chatImage',
          attrs: {
            src: '/api/storage/chat-images/photo.jpg',
            alt: 'a'.repeat(1000),
            onerror: 'alert(1)',
            class: 'evil',
          },
        },
      ],
    }
    const result = sanitizeTiptapContent(input)
    const node = result.content!.find((n) => n.type === 'chatImage')
    expect(node!.attrs!.src).toBe('/api/storage/chat-images/photo.jpg')
    expect((node!.attrs!.alt as string).length).toBe(500)
    expect(node!.attrs!.onerror).toBeUndefined()
    expect(node!.attrs!.class).toBeUndefined()
  })

  // ============================================
  // Support-grade preset round-trip (P0.2)
  // ============================================
  // The upgraded ticket/conversation composers emit this full node set. Each
  // case is a true round-trip (sanitize(doc) deep-equals doc) so a future
  // gap in the allowlist regresses loudly instead of silently dropping content.

  it('round-trips a codeBlock with its language attr and text content', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'bash' },
          content: [{ type: 'text', text: 'curl https://example.com' }],
        },
      ],
    }
    expect(sanitizeTiptapContent(doc)).toEqual(doc)
  })

  it('round-trips a resizableImage with src/width/height/data-keep-ratio', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'resizableImage',
          attrs: {
            src: 'https://example.com/photo.png',
            alt: 'A photo',
            width: 400,
            height: 300,
            'data-keep-ratio': true,
          },
        },
      ],
    }
    expect(sanitizeTiptapContent(doc)).toEqual(doc)
  })

  it('round-trips a mention with its id/label attrs', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hey ' },
            {
              type: 'mention',
              attrs: { id: 'user_01ktjwt5tyf6br9mw521h13n6n', label: 'Jane Doe' },
            },
          ],
        },
      ],
    }
    expect(sanitizeTiptapContent(doc)).toEqual(doc)
  })

  it('round-trips the full support-grade node set unchanged', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hey ' },
            {
              type: 'mention',
              attrs: { id: 'user_01ktjwt5tyf6br9mw521h13n6n', label: 'Jane Doe' },
            },
            { type: 'text', text: ', see ' },
            {
              type: 'text',
              text: 'this',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com/path',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  },
                },
              ],
            },
            { type: 'text', text: ' ' },
            { type: 'emoji', attrs: { name: 'smile', emoji: '😄' } },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'bash' },
          content: [{ type: 'text', text: 'curl https://example.com' }],
        },
        {
          type: 'resizableImage',
          attrs: {
            src: 'https://example.com/photo.png',
            alt: 'A photo',
            width: 400,
            height: 300,
            'data-keep-ratio': true,
          },
        },
        {
          type: 'chatImage',
          attrs: { src: '/api/storage/chat-images/photo.png', alt: 'A screenshot' },
        },
        { type: 'quackbackEmbed', attrs: { kind: 'post', id: EMBED_POST_ID } },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quote' }] }],
        },
      ],
    }
    expect(sanitizeTiptapContent(doc)).toEqual(doc)
  })

  it('caps total node count (doc-bomb protection)', () => {
    const input = {
      type: 'doc',
      content: Array.from({ length: 6000 }, () => ({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x' }],
      })),
    }
    const result = sanitizeTiptapContent(input)
    // The doc node + paragraphs + their text nodes are all counted; the tree is
    // truncated well below the 6000 paragraphs once the 5000-node budget is hit.
    expect(result.content!.length).toBeLessThan(6000)
  })
})
