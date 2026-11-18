import { describe, it, expect } from 'vitest'
import { appendWidgetOtt, buildPortalUrl, widgetChangelogUrl } from '../build-portal-url'

describe('buildPortalUrl', () => {
  const baseUrl = 'https://feedback.example.com'
  const boardSlug = 'feature-requests'
  const postId = 'post_abc123'

  it('sends identified visitors through widget-handoff with returnTo', () => {
    const url = buildPortalUrl({
      origin: baseUrl,
      boardSlug,
      postId,
      isIdentified: true,
      ott: 'ott-token-123',
    })
    expect(url).toBe(
      'https://feedback.example.com/auth/widget-handoff?ott=ott-token-123&returnTo=%2Fb%2Ffeature-requests%2Fposts%2Fpost_abc123'
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
    expect(url).toContain('ott=token%2Bwith%2Fspecial%3Dchars')
    expect(url).toContain('/auth/widget-handoff?')
  })
})

describe('appendWidgetOtt', () => {
  it('routes identified visitors through widget-handoff', () => {
    expect(
      appendWidgetOtt('https://feedback.example.com/hc/articles/getting-started/faq', true, 'ott-1')
    ).toBe(
      'https://feedback.example.com/auth/widget-handoff?ott=ott-1&returnTo=%2Fhc%2Farticles%2Fgetting-started%2Ffaq'
    )
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

describe('widgetChangelogUrl', () => {
  const origin = 'https://acme.com'
  const origins = {
    primary: 'https://acme.com',
    feedback: 'https://acme.com',
    roadmap: 'https://acme.com',
    changelog: 'https://updates.acme.com',
    help: 'https://acme.com',
    support: 'https://acme.com',
    status: 'https://acme.com',
  }

  it("links an anonymous visitor straight to the changelog's own host", () => {
    expect(
      widgetChangelogUrl({ origin, entryId: 'cl_1', origins, isIdentified: false, ott: null })
    ).toBe('https://updates.acme.com/changelog/cl_1')
  })

  it('links to the widget origin when the changelog has no host of its own', () => {
    expect(
      widgetChangelogUrl({
        origin,
        entryId: 'cl_1',
        origins: { ...origins, changelog: 'https://acme.com' },
        isIdentified: false,
        ott: null,
      })
    ).toBe('https://acme.com/changelog/cl_1')
    expect(
      widgetChangelogUrl({ origin, entryId: 'cl_1', origins: null, isIdentified: false, ott: null })
    ).toBe('https://acme.com/changelog/cl_1')
  })

  it('signs an identified visitor in on the widget origin, and the move on carries the session', () => {
    // widget-handoff sets the session on this origin and lands on
    // /changelog/cl_1 here, which the section host middleware sends through
    // the section handoff to the changelog's host.
    expect(
      widgetChangelogUrl({ origin, entryId: 'cl_1', origins, isIdentified: true, ott: 'ott-1' })
    ).toBe('https://acme.com/auth/widget-handoff?ott=ott-1&returnTo=%2Fchangelog%2Fcl_1')
  })
})
