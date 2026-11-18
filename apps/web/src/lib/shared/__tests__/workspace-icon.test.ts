import { describe, it, expect } from 'vitest'
import { pageIconHref, QUACKBACK_ICON, DEFAULT_WORKSPACE_ICON } from '../workspace-icon'

const settings = (favicon: string | null, logo: string | null) => ({
  faviconData: favicon ? { url: favicon } : null,
  brandingData: { logoUrl: logo },
})

describe('pageIconHref', () => {
  describe("Quackback's own pages keep the Quackback icon", () => {
    it.each([
      '/admin',
      '/admin/inbox',
      '/admin/login',
      '/admin/signup',
      '/onboarding',
      '/onboarding/account',
      '/apps/zendesk/sidebar',
      '/device',
      '/oauth/consent',
      '/complete-signup/abc',
    ])('%s', (pathname) => {
      expect(pageIconHref(pathname, settings('/f.png', '/l.png'))).toBe(QUACKBACK_ICON)
    })
  })

  describe("customer-facing pages use the workspace's icon", () => {
    it.each([
      '/',
      '/b/features',
      '/b/features/posts/p1',
      '/roadmap',
      '/changelog',
      '/hc',
      '/hc/en/articles/a-1',
      '/status',
      '/auth/login',
      '/auth/reset-password',
      '/csat',
      '/unsubscribe',
      '/portal-invite/i1',
      '/verify-magic-link',
      '/administrators-guide',
    ])('%s', (pathname) => {
      expect(pageIconHref(pathname, settings('/f.png', '/l.png'))).toBe('/f.png')
    })
  })

  it('prefers the dedicated favicon, then the workspace logo, then the default', () => {
    expect(pageIconHref('/', settings('/f.png', '/l.png'))).toBe('/f.png')
    expect(pageIconHref('/', settings(null, '/l.png'))).toBe('/l.png')
    expect(pageIconHref('/', settings(null, null))).toBe(DEFAULT_WORKSPACE_ICON)
    expect(pageIconHref('/', null)).toBe(DEFAULT_WORKSPACE_ICON)
  })
})
