// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CommentContent, hasMarkdownTokens } from '../comment-content'

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

  it('renders markdown headings', () => {
    const { container } = render(<CommentContent content={'## Heading\n\nbody'} />)
    expect(container.querySelector('h2')).not.toBeNull()
  })

  it('renders bold via markdown syntax', () => {
    const { container } = render(<CommentContent content="this is **bold** here" />)
    expect(container.querySelector('strong')).not.toBeNull()
  })

  it('renders italic via single-asterisk markdown syntax', () => {
    const { container } = render(<CommentContent content="this is *italic* here" />)
    expect(container.querySelector('em')).not.toBeNull()
  })

  it('does not render an <img> for image markdown', () => {
    const { container } = render(<CommentContent content="![alt](https://x.com/y.png)" />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('does not render a <table> for table markdown', () => {
    const { container } = render(<CommentContent content={'| a | b |\n|---|---|\n| 1 | 2 |'} />)
    expect(container.querySelector('table')).toBeNull()
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

  it('falls back to markdown when contentJson is null (optimistic cache case)', () => {
    const { container } = render(<CommentContent content="**bold**" contentJson={null} />)
    expect(container.querySelector('strong')).not.toBeNull()
  })
})
