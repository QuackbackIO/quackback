// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, renderHook, waitFor } from '@testing-library/react'

// CommentContent wraps rendered content in MentionHoverCardOverlay, which
// reads branding from the root route context. Stub the hook so the test
// component tree doesn't need a real router.
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({
    settings: {
      brandingData: { logoUrl: null, name: 'Acme' },
      name: 'Acme',
    },
  }),
}))

import { CommentContent, hasMarkdownTokens, useCommentDoc } from '../comment-content'

describe('hasMarkdownTokens', () => {
  it('returns false for empty string', () => {
    expect(hasMarkdownTokens('')).toBe(false)
  })

  it('returns false for plain prose', () => {
    expect(hasMarkdownTokens('Just a normal sentence without formatting.')).toBe(false)
  })

  it('detects headings', () => {
    expect(hasMarkdownTokens('## Heading')).toBe(true)
    expect(hasMarkdownTokens('# Top\n\nbody')).toBe(true)
  })

  it('detects bullet and ordered lists at line start', () => {
    expect(hasMarkdownTokens('- item')).toBe(true)
    expect(hasMarkdownTokens('* item')).toBe(true)
    expect(hasMarkdownTokens('1. item')).toBe(true)
  })

  it('detects fenced code', () => {
    expect(hasMarkdownTokens('```ts\nconst x = 1\n```')).toBe(true)
  })

  it('detects inline code', () => {
    expect(hasMarkdownTokens('use `npm i` first')).toBe(true)
  })

  it('detects bold and strikethrough markers', () => {
    expect(hasMarkdownTokens('this is **bold**')).toBe(true)
    expect(hasMarkdownTokens('this is __bold__')).toBe(true)
    expect(hasMarkdownTokens('this is ~~strike~~')).toBe(true)
  })

  it('detects single-delimiter italic', () => {
    expect(hasMarkdownTokens('this is *italic*')).toBe(true)
    expect(hasMarkdownTokens('this is _italic_')).toBe(true)
  })

  it('does not flag bare asterisks or underscores inside words', () => {
    expect(hasMarkdownTokens('a*b*c')).toBe(false)
    expect(hasMarkdownTokens('snake_case_variable')).toBe(false)
    expect(hasMarkdownTokens('3 * 4 = 12')).toBe(false)
  })

  it('detects link syntax', () => {
    expect(hasMarkdownTokens('see [docs](https://x.com)')).toBe(true)
  })

  it('detects blockquotes', () => {
    expect(hasMarkdownTokens('> quoted')).toBe(true)
  })
})

describe('<CommentContent>', () => {
  it('renders plain text in the fast-path wrapper', () => {
    const { container } = render(<CommentContent content="plain comment" />)
    const p = container.querySelector('p.whitespace-pre-wrap')
    expect(p?.textContent).toBe('plain comment')
    expect(container.querySelector('h1, h2, h3, ul, strong')).toBeNull()
  })

  // The markdown parser loads on demand, so parsed markdown appears after a tick.
  it('renders markdown headings', async () => {
    const { container } = render(<CommentContent content={'## Heading\n\nbody'} />)
    await waitFor(() => expect(container.querySelector('h2')).not.toBeNull())
  })

  it('renders bold via markdown syntax', async () => {
    const { container } = render(<CommentContent content="this is **bold** here" />)
    await waitFor(() => expect(container.querySelector('strong')).not.toBeNull())
  })

  it('renders italic via single-asterisk markdown syntax', async () => {
    const { container } = render(<CommentContent content="this is *italic* here" />)
    await waitFor(() => expect(container.querySelector('em')).not.toBeNull())
  })

  it('renders an <img> for image markdown', async () => {
    const { container } = render(<CommentContent content="![alt](https://x.com/y.png)" />)
    await waitFor(() => {
      expect(container.querySelector('img')).not.toBeNull()
    })
  })

  it('renders a <table> for table markdown', async () => {
    const { container } = render(<CommentContent content={'| a | b |\n|---|---|\n| 1 | 2 |'} />)
    await waitFor(() => {
      expect(container.querySelector('table')).not.toBeNull()
    })
  })

  it('does not render a <script> for embedded HTML', () => {
    const { container } = render(<CommentContent content={'<script>alert(1)</script>\n\nHello'} />)
    expect(container.querySelector('script')).toBeNull()
  })

  it('applies a className override', () => {
    const { container } = render(<CommentContent content="plain" className="my-extra" />)
    expect(container.querySelector('.my-extra')).not.toBeNull()
  })

  it('renders from contentJson when present, skipping the markdown parse', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'precomputed', marks: [{ type: 'bold' }] }],
        },
      ],
    }
    // content deliberately differs to prove contentJson takes precedence
    const { container } = render(<CommentContent content="ignored markdown" contentJson={json} />)
    expect(container.querySelector('strong')?.textContent).toBe('precomputed')
  })

  it('falls back to markdown when contentJson is null (optimistic cache case)', async () => {
    const { container } = render(<CommentContent content="**bold**" contentJson={null} />)
    await waitFor(() => expect(container.querySelector('strong')).not.toBeNull())
  })

  it('renders emoji nodes inside contentJson (Unicode char survives the JSON fast-path)', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Looks good ' },
            { type: 'emoji', attrs: { name: 'thumbsup', emoji: '👍' } },
          ],
        },
      ],
    }
    const { container } = render(<CommentContent content="Looks good 👍" contentJson={json} />)
    // The emoji char must appear in the rendered output - regression test for
    // RichTextContent's default branch dropping unrecognised leaf nodes.
    expect(container.textContent).toContain('👍')
  })

  it('renders emoji nodes that only carry a shortcode name (TipTap omits the Unicode char in JSON)', async () => {
    // @tiptap/extension-emoji persists `{ name: 'tada' }` without `emoji`. The
    // read-only renderer keeps the heavy emoji dataset OUT of the eager portal
    // chunk, so it shows the `:tada:` shortcode placeholder first and then
    // upgrades to the Unicode char after an on-demand dynamic import resolves.
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Shipped ' },
            { type: 'emoji', attrs: { name: 'tada' } },
          ],
        },
      ],
    }
    const { container } = render(<CommentContent content="Shipped :tada:" contentJson={json} />)
    await waitFor(() => expect(container.textContent).toContain('🎉'))
  })

  it('upgrades a name-only crossed_fingers node (name is not in shortcodes[])', async () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Luck ' },
            { type: 'emoji', attrs: { name: 'crossed_fingers' } },
          ],
        },
      ],
    }
    const { container } = render(
      <CommentContent content="Luck :crossed_fingers:" contentJson={json} />
    )
    await waitFor(() => expect(container.textContent).toContain('🤞'))
    expect(container.textContent).not.toContain(':crossed_fingers:')
  })
})

describe('useCommentDoc', () => {
  const stored = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'stored' }] }],
  }

  it('returns the stored doc at once', () => {
    const { result } = renderHook(() => useCommentDoc('## ignored', stored, true))
    expect(result.current).toBe(stored)
  })

  it('leaves a legacy markdown row unparsed until enabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useCommentDoc('## Legacy heading', null, enabled),
      { initialProps: { enabled: false } }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.current).toBeNull()

    rerender({ enabled: true })
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current?.content?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Legacy heading' }],
    })
  })

  it('parses again when the markdown changes', async () => {
    const { result, rerender } = renderHook(({ markdown }) => useCommentDoc(markdown, null, true), {
      initialProps: { markdown: 'first **one**' },
    })
    await waitFor(() => expect(JSON.stringify(result.current)).toContain('first '))
    rerender({ markdown: 'second **two**' })
    expect(result.current).toBeNull()
    await waitFor(() => expect(JSON.stringify(result.current)).toContain('second '))
  })
})
