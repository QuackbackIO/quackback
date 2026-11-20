// @vitest-environment node
/**
 * The help center sitemap lists absolute URLs. Behind the TLS proxy the app
 * sees the request as http, so the origin comes from where the help center is
 * linked: its own host once it has one, else the configured base URL. Never
 * from the request's own scheme. Sending the primary domain's sitemap to the
 * help center's host is the section host middleware's job.
 */
import { describe, it, expect, vi } from 'vitest'
import { allOnPrimary, type SectionOrigins } from '@/lib/shared/section-links'

const state = vi.hoisted(() => ({
  origins: null as SectionOrigins | null,
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
    domain: { domain: null, verifiedAt: null },
  }),
}))

vi.mock('@/lib/server/domains/settings/section-links', () => ({
  getSectionOrigins: async () => state.origins,
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
    state.origins = allOnPrimary('https://feedback.example.com')
    expect(await sitemapLocs('http://feedback.example.com/hc/sitemap.xml')).toEqual([
      'https://feedback.example.com/hc',
      'https://feedback.example.com/hc/en/collections/1-basics',
    ])
  })

  it("lists the help center's own host, its home as /, once it has one", async () => {
    state.origins = {
      ...allOnPrimary('https://feedback.example.com'),
      help: 'https://help.acme.com',
    }
    expect(await sitemapLocs('https://help.acme.com/hc/sitemap.xml')).toEqual([
      'https://help.acme.com/',
      'https://help.acme.com/hc/en/collections/1-basics',
    ])
  })
})
