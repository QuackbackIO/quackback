import { describe, it, expect } from 'vitest'
import { buildPortalUrl } from '../build-portal-url'

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
