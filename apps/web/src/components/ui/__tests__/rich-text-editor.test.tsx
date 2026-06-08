// @vitest-environment happy-dom
/**
 * Tests for mention rendering in generateContentHTML and RichTextContent.
 *
 *  - generateContentHTML emits a styled <span class="mention"> with
 *    data-principal-id and data-display-name attrs.
 *  - Attribute values are HTML-escaped so they survive a malicious label
 *    without breaking out of the attribute.
 *  - RichTextContent runs the output through DOMPurify on the client. The
 *    allow-list must include both data attributes so the hover-card overlay
 *    can resolve the chip by principalId.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { JSONContent } from '@tiptap/core'
import { generateContentHTML, RichTextContent } from '../rich-text-editor'

describe('generateContentHTML — mention nodes', () => {
  it('emits styled span with data attributes for mention nodes', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'mention', attrs: { id: 'principal_jane', label: 'Jane Doe' } },
          ],
        },
      ],
    })
    expect(html).toContain('class="mention"')
    expect(html).toContain('data-principal-id="principal_jane"')
    expect(html).toContain('data-display-name="Jane Doe"')
    expect(html).toContain('@Jane Doe')
  })

  it('escapes attribute values to prevent injection', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { id: 'principal_x', label: 'Evil"><script>x</script>' },
            },
          ],
        },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;')
    expect(html).toContain('&lt;script&gt;')
  })

  it('skips mention nodes that have no id', () => {
    const html = generateContentHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { label: 'NoId' } }],
        },
      ],
    })
    expect(html).not.toContain('class="mention"')
  })
})

describe('RichTextContent — mention chip survives DOMPurify', () => {
  it('retains data-principal-id and data-display-name after sanitization', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'principal_x', label: 'X' } }],
        },
      ],
    }
    const { container } = render(<RichTextContent content={doc} />)
    const chip = container.querySelector('.mention') as HTMLElement | null
    expect(chip).not.toBeNull()
    expect(chip!.getAttribute('data-principal-id')).toBe('principal_x')
    expect(chip!.getAttribute('data-display-name')).toBe('X')
    expect(chip!.textContent).toBe('@X')
  })
})

describe('RichTextContent — embed placeholder survives DOMPurify', () => {
  it('retains data-quackback-embed/kind/id after sanitization', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'quackbackEmbed',
          attrs: { kind: 'post', id: 'post_01ktjwt5tyf6br9mw521h13n6n' },
        },
      ],
    }
    const { container } = render(<RichTextContent content={doc} />)
    const placeholder = container.querySelector('[data-quackback-embed]') as HTMLElement | null
    expect(placeholder).not.toBeNull()
    expect(placeholder!.getAttribute('data-kind')).toBe('post')
    expect(placeholder!.getAttribute('data-id')).toBe('post_01ktjwt5tyf6br9mw521h13n6n')
  })
})
