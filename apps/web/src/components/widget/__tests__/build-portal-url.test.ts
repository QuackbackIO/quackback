import { describe, it, expect } from 'vitest'
import { appendWidgetOtt, buildPortalUrl } from '../build-portal-url'

describe('buildPortalUrl', () => {
  const baseUrl = 'https://feedback.example.com'
  const boardSlug = 'feature-requests'
  const postId = 'post_abc123'

  it('includes OTT param when user is identified and OTT is available', () => {
    const url = buildPortalUrl({
      origin: baseUrl,
      boardSlug,
      postId,
      isIdentified: true,
      ott: 'ott-token-123',
    })
    expect(url).toBe(
      'https://feedback.example.com/b/feature-requests/posts/post_abc123?ott=ott-token-123'
    )
  })

  it('omits OTT param when user is anonymous', () => {
    const url = buildPortalUrl({
      origin: baseUrl,
      boardSlug,
      postId,
      isIdentified: false,
      ott: 'ott-token-123',
    })
    expect(url).toBe('https://feedback.example.com/b/feature-requests/posts/post_abc123')
  })

  it('omits OTT param when OTT generation returned null', () => {
    const url = buildPortalUrl({
      origin: baseUrl,
      boardSlug,
      postId,
      isIdentified: true,
      ott: null,
    })
    expect(url).toBe('https://feedback.example.com/b/feature-requests/posts/post_abc123')
  })

  it('omits OTT param when user is anonymous even if OTT is null', () => {
    const url = buildPortalUrl({
      origin: baseUrl,
      boardSlug,
      postId,
      isIdentified: false,
      ott: null,
    })
    expect(url).toBe('https://feedback.example.com/b/feature-requests/posts/post_abc123')
  })

  it('URL-encodes the OTT param value', () => {
    const url = buildPortalUrl({
      origin: baseUrl,
      boardSlug,
      postId,
      isIdentified: true,
      ott: 'token+with/special=chars',
    })
    expect(url).toContain('?ott=token%2Bwith%2Fspecial%3Dchars')
  })
})

describe('appendWidgetOtt', () => {
  it('appends ott when identified', () => {
    expect(
      appendWidgetOtt('https://feedback.example.com/hc/articles/getting-started/faq', true, 'ott-1')
    ).toBe('https://feedback.example.com/hc/articles/getting-started/faq?ott=ott-1')
  })

  it('leaves the URL unchanged for anonymous visitors', () => {
    expect(
      appendWidgetOtt('https://feedback.example.com/changelog/changelog_1', false, 'ott-1')
    ).toBe('https://feedback.example.com/changelog/changelog_1')
  })

  it('leaves the URL unchanged when OTT generation returned null', () => {
    expect(appendWidgetOtt('https://feedback.example.com/changelog/changelog_1', true, null)).toBe(
      'https://feedback.example.com/changelog/changelog_1'
    )
  })
})
