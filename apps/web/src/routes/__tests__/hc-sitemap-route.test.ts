// @vitest-environment node
/**
 * The help center sitemap lists absolute URLs. Behind the TLS proxy the app
 * sees the request as http, so the origin has to come from the configured base
 * URL, or from the verified custom domain the request arrived on, the same
 * rule the canonical links use. Never from the request's own scheme.
 */
import { describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({
  domain: { domain: null as string | null, verifiedAt: null as string | null },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (opts: unknown) => ({ path, options: opts }),
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://feedback.example.com' },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: async () => true,
  getHelpCenterConfig: async () => ({
    locales: { default: 'en', additional: [] },
    seo: { indexable: true },
    domain: state.domain,
  }),
}))

vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  listPublicCategories: async () => [{ id: 'cat_1', urlId: 1, slug: 'basics' }],
  listPublicArticles: async () => ({ items: [] }),
}))

vi.mock('@/lib/server/domains/help-center/help-center-locale.query', () => ({
  listPublicCategoriesForLocale: async () => [],
  listPublicArticlesForCategoryLocale: async () => [],
}))

import { Route } from '../hc/sitemap[.]xml'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
const { GET } = (Route as unknown as { options: { server: { handlers: Handlers } } }).options.server
  .handlers

async function sitemapLocs(requestUrl: string): Promise<string[]> {
  const response = await GET({ request: new Request(requestUrl) })
  expect(response.status).toBe(200)
  return [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}

describe('help center sitemap origin', () => {
  it('lists https URLs when the request reaches the app over http behind a proxy', async () => {
    state.domain = { domain: null, verifiedAt: null }
    expect(await sitemapLocs('http://feedback.example.com/hc/sitemap.xml')).toEqual([
      'https://feedback.example.com/hc',
      'https://feedback.example.com/hc/en/collections/1-basics',
    ])
  })

  it('uses the verified custom domain when the request arrived on it', async () => {
    state.domain = { domain: 'help.acme.com', verifiedAt: '2026-10-01T00:00:00.000Z' }
    const locs = await sitemapLocs('https://help.acme.com/hc/sitemap.xml')
    expect(locs).toEqual([
      'https://help.acme.com/hc',
      'https://help.acme.com/hc/en/collections/1-basics',
    ])
  })

  it('redirects the default host to the verified custom domain, keeping the query', async () => {
    state.domain = { domain: 'help.acme.com', verifiedAt: '2026-10-01T00:00:00.000Z' }
    const response = await GET({
      request: new Request('https://feedback.example.com/hc/sitemap.xml?page=2'),
    })
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://help.acme.com/hc/sitemap.xml?page=2')
  })
})
