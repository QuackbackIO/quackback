/**
 * The pure TipTap-JSON → HTML serializer extracted from the rich-text editor so
 * it can run server-side (e.g. outbound conversation email) with no React,
 * tiptap-react, or browser globals. These pin the block/mark rendering the email
 * body relies on, and the text-node escaping that stops stored content from
 * injecting raw HTML into a recipient's inbox.
 */
import { describe, it, expect } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { generateContentHTML } from '../content-html'

describe('generateContentHTML', () => {
  it('renders paragraphs with bold and italic marks', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    })
    expect(html).toBe('<p>Hello <strong>bold</strong> and <em>italic</em></p>')
  })

  it('renders bullet lists, unwrapping single-paragraph list items', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    })
    expect(html).toBe('<ul><li>one</li><li>two</li></ul>')
  })

  it('renders ordered lists', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
            },
          ],
        },
      ],
    })
    expect(html).toBe('<ol><li>first</li></ol>')
  })

  it('renders a code block, escaping its contents and carrying the language class', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1 < 2' }],
        },
      ],
    })
    expect(html).toContain('<pre')
    expect(html).toContain('class="language-ts"')
    expect(html).toContain('const x = 1 &lt; 2')
  })

  it('renders an image node with a sanitized src', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'https://cdn.example.com/a.png', alt: 'shot' },
        },
      ],
    })
    expect(html).toContain('<img')
    expect(html).toContain('src="https://cdn.example.com/a.png"')
    expect(html).toContain('alt="shot"')
  })

  it('drops an image with an unsafe (javascript:) src', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
    })
    expect(html).not.toContain('<img')
  })

  it('renders a mention chip with escaped data attributes', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'principal_jane', label: 'Jane' } }],
        },
      ],
    })
    expect(html).toContain('class="mention"')
    expect(html).toContain('data-principal-id="principal_jane"')
    expect(html).toContain('@Jane')
  })

  it('escapes <script> in text nodes so stored content cannot inject HTML', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '<script>alert(1)</script> & <b>x</b>' }],
        },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;x&lt;/b&gt;')
  })

  it('renders a combined document (paragraph + bold + list + code + image) as expected HTML', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Intro ' },
            { type: 'text', text: 'strong', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'js' },
          content: [{ type: 'text', text: 'x()' }],
        },
        { type: 'image', attrs: { src: 'https://cdn.example.com/z.png', alt: '' } },
      ],
    }
    const html = generateContentHTML(doc)
    expect(html).toBe(
      '<p>Intro <strong>strong</strong></p>' +
        '<ul><li>item</li></ul>' +
        '<pre class="not-prose rounded-lg bg-muted p-4 overflow-x-auto"><code class="language-js">x()</code></pre>' +
        '<img src="https://cdn.example.com/z.png" alt="" class="max-w-full h-auto rounded-lg"  />'
    )
  })
})
