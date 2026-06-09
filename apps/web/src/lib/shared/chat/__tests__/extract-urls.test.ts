import { describe, it, expect } from 'vitest'
import { extractPreviewableUrls } from '../extract-urls'
import type { TiptapContent } from '@/lib/shared/db-types'

// A real post URL that parseEmbedUrl recognises as internal (post_ TypeID from parse-embed-url.test.ts)
const INTERNAL_POST_URL =
  'https://acme.quackback.io/b/features/posts/post_01ktjwt5tyf6br9mw521h13n6n'
const EXTERNAL_1 = 'https://example.com'
const EXTERNAL_2 = 'https://news.ycombinator.com/item?id=123'
const EXTERNAL_3 = 'https://github.com/foo/bar'
const EXTERNAL_4 = 'https://twitter.com/status/456'

describe('extractPreviewableUrls', () => {
  it('extracts http(s) URLs from plain text content', () => {
    const result = extractPreviewableUrls(`check out ${EXTERNAL_1} and ${EXTERNAL_2}`, null)
    expect(result).toContain(EXTERNAL_1)
    expect(result).toContain(EXTERNAL_2)
  })

  it('excludes non-http/https URLs from plain text', () => {
    const result = extractPreviewableUrls('ftp://bad.com see also mailto:a@b.com', null)
    expect(result).toHaveLength(0)
  })

  it('extracts href from link marks in contentJson', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click here',
              marks: [{ type: 'link', attrs: { href: EXTERNAL_3 } }],
            },
          ],
        },
      ],
    }
    const result = extractPreviewableUrls('click here', doc)
    expect(result).toContain(EXTERNAL_3)
  })

  it('excludes internal Quackback URLs', () => {
    const result = extractPreviewableUrls(`visit ${INTERNAL_POST_URL} and ${EXTERNAL_1}`, null)
    expect(result).not.toContain(INTERNAL_POST_URL)
    expect(result).toContain(EXTERNAL_1)
  })

  it('deduplicates URLs', () => {
    const text = `${EXTERNAL_1} and again ${EXTERNAL_1}`
    const result = extractPreviewableUrls(text, null)
    expect(result.filter((u) => u === EXTERNAL_1)).toHaveLength(1)
  })

  it('caps at 3 URLs', () => {
    const text = [EXTERNAL_1, EXTERNAL_2, EXTERNAL_3, EXTERNAL_4].join(' ')
    const result = extractPreviewableUrls(text, null)
    expect(result).toHaveLength(3)
  })

  it('returns empty array for empty content', () => {
    expect(extractPreviewableUrls('', null)).toEqual([])
    expect(extractPreviewableUrls('no links here', null)).toEqual([])
  })

  it('never throws on bad input', () => {
    expect(() => extractPreviewableUrls(null as unknown as string, undefined)).not.toThrow()
    expect(() =>
      extractPreviewableUrls('', { type: 'doc', content: [{ type: 'BAD' }] })
    ).not.toThrow()
  })

  it('handles deeply nested link marks in contentJson', () => {
    const doc: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'nested',
                  marks: [{ type: 'link', attrs: { href: EXTERNAL_4 } }],
                },
              ],
            },
          ],
        },
      ],
    }
    const result = extractPreviewableUrls('nested', doc)
    expect(result).toContain(EXTERNAL_4)
  })
})
