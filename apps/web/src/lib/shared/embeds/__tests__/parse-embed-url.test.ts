import { describe, it, expect } from 'vitest'
import {
  parseEmbedUrl,
  POST_URL_PASTE_RE,
  CHANGELOG_URL_PASTE_RE,
  ARTICLE_URL_PASTE_RE,
  TICKET_URL_PASTE_RE,
} from '../parse-embed-url'

// Real, round-trip-valid TypeIDs. The changelog prefix is `changelog_`
// (per @quackback/ids ID_PREFIXES), not `clog_`, and isValidTypeId rejects
// structurally-bogus suffixes — so the parser only accepts ids that can
// actually resolve.
const POST_ID = 'post_01ktjwt5tyf6br9mw521h13n6n'
const CHANGELOG_ID = 'changelog_01ktjwt5tyf6br9mwcz1vskk44'
const TICKET_ID = 'ticket_01ktjwt5tyf6br9mw521h13n6n'

describe('parseEmbedUrl', () => {
  it('parses a post url', () => {
    expect(parseEmbedUrl(`https://acme.quackback.io/b/features/posts/${POST_ID}`)).toEqual({
      kind: 'post',
      id: POST_ID,
    })
  })
  it('parses a changelog url', () => {
    expect(parseEmbedUrl(`https://acme.quackback.io/changelog/${CHANGELOG_ID}`)).toEqual({
      kind: 'changelog',
      id: CHANGELOG_ID,
    })
  })
  it('rejects a non-typeid id', () => {
    expect(parseEmbedUrl('https://acme.quackback.io/b/x/posts/not-an-id')).toBeNull()
  })
  it('rejects a typeid of the wrong kind', () => {
    // A post id sitting on the changelog path must not parse as a changelog.
    expect(parseEmbedUrl(`https://acme.quackback.io/changelog/${POST_ID}`)).toBeNull()
  })
  it('parses a support ticket url', () => {
    expect(parseEmbedUrl(`https://acme.quackback.io/support/ticket/${TICKET_ID}`)).toEqual({
      kind: 'ticket',
      id: TICKET_ID,
    })
  })
  it('rejects a non-typeid ticket id', () => {
    expect(parseEmbedUrl('https://acme.quackback.io/support/ticket/not-an-id')).toBeNull()
  })
  it('ignores unrelated urls', () => {
    expect(parseEmbedUrl('https://youtube.com/watch?v=abc')).toBeNull()
    expect(parseEmbedUrl('https://acme.quackback.io/?board=features')).toBeNull()
    expect(parseEmbedUrl('not a url')).toBeNull()
  })
})

describe('paste regexes', () => {
  // The regexes carry the global flag (required by nodePasteRule), so a fresh
  // match per assertion avoids lastIndex statefulness biting us.
  it('POST_URL_PASTE_RE captures the post id from a full url', () => {
    const m = new RegExp(POST_URL_PASTE_RE).exec(
      `https://acme.quackback.io/b/features/posts/${POST_ID}`
    )
    expect(m?.[1]).toBe(POST_ID)
  })
  it('CHANGELOG_URL_PASTE_RE captures the changelog id from a full url', () => {
    const m = new RegExp(CHANGELOG_URL_PASTE_RE).exec(
      `https://acme.quackback.io/changelog/${CHANGELOG_ID}`
    )
    expect(m?.[1]).toBe(CHANGELOG_ID)
  })
  it('TICKET_URL_PASTE_RE captures the ticket id from a full url', () => {
    const m = new RegExp(TICKET_URL_PASTE_RE).exec(
      `https://acme.quackback.io/support/ticket/${TICKET_ID}`
    )
    expect(m?.[1]).toBe(TICKET_ID)
  })
  it('neither paste regex matches a foreign url', () => {
    const foreign = 'https://youtube.com/watch?v=abc'
    expect(new RegExp(POST_URL_PASTE_RE).test(foreign)).toBe(false)
    expect(new RegExp(CHANGELOG_URL_PASTE_RE).test(foreign)).toBe(false)
    expect(new RegExp(TICKET_URL_PASTE_RE).test(foreign)).toBe(false)
  })
})

describe('parseEmbedUrl — article', () => {
  it('parses a help-center article url', () => {
    expect(
      parseEmbedUrl(
        'https://acme.example.com/hc/articles/getting-started/how-to-reset-your-password'
      )
    ).toEqual({ kind: 'article', id: 'how-to-reset-your-password' })
  })
  it('ignores the category segment — only the article slug is captured', () => {
    expect(parseEmbedUrl('https://acme.example.com/hc/articles/cat/my-article')).toEqual({
      kind: 'article',
      id: 'my-article',
    })
  })
  it('rejects a help-center article url with a trailing slash (empty slug)', () => {
    expect(parseEmbedUrl('https://acme.example.com/hc/articles/getting-started/')).toBeNull()
  })
  it('ignores unrelated hc paths', () => {
    expect(parseEmbedUrl('https://acme.example.com/hc/categories/getting-started')).toBeNull()
    expect(parseEmbedUrl('https://acme.example.com/hc/articles')).toBeNull()
  })
})

describe('paste regexes — article', () => {
  it('ARTICLE_URL_PASTE_RE captures the article slug from a full url', () => {
    const m = new RegExp(ARTICLE_URL_PASTE_RE).exec(
      'https://acme.example.com/hc/articles/getting-started/how-to-reset'
    )
    expect(m?.[1]).toBe('how-to-reset')
  })
  it('ARTICLE_URL_PASTE_RE does not match foreign urls', () => {
    expect(new RegExp(ARTICLE_URL_PASTE_RE).test('https://example.com/other')).toBe(false)
  })
  it('ARTICLE_URL_PASTE_RE does not match post or changelog urls', () => {
    const postUrl = `https://acme.example.com/b/features/posts/${POST_ID}`
    const clUrl = `https://acme.example.com/changelog/${CHANGELOG_ID}`
    expect(new RegExp(ARTICLE_URL_PASTE_RE).test(postUrl)).toBe(false)
    expect(new RegExp(ARTICLE_URL_PASTE_RE).test(clUrl)).toBe(false)
  })
})
