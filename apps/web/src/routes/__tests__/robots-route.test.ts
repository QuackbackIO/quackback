// @vitest-environment node
/**
 * robots.txt points at the sitemaps of the host that served it. The primary
 * domain advertises its own sitemap, and the help center's while the help
 * center lives there. A section on its own host (help.acme.com) advertises
 * that section's sitemap, on that host, and nothing else.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { allOnPrimary, type SectionOrigins } from '@/lib/shared/section-links'

const PRIMARY = 'https://feedback.example.com'

const state = vi.hoisted(() => ({
  origins: null as SectionOrigins | null,
  indexable: true,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (opts: unknown) => ({ path, options: opts }),
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://feedback.example.com' },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: async () => true,
  getHelpCenterConfig: async () => ({ seo: { indexable: state.indexable } }),
}))

vi.mock('@/lib/server/domains/settings/section-links', () => ({
  getSectionOrigins: async () => state.origins,
}))

import { Route } from '../robots[.]txt'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
const { GET } = (Route as unknown as { options: { server: { handlers: Handlers } } }).options.server
  .handlers

async function robots(requestUrl: string): Promise<string[]> {
  const response = await GET({ request: new Request(requestUrl) })
  expect(response.headers.get('vary')).toBe('Host')
  return (await response.text()).split('\n')
}

async function sitemapLines(requestUrl: string): Promise<string[]> {
  return (await robots(requestUrl)).filter((line) => line.startsWith('Sitemap: '))
}

beforeEach(() => {
  state.origins = allOnPrimary(PRIMARY)
  state.indexable = true
})

describe('robots.txt sitemap lines', () => {
  it('advertises both sitemaps on the primary domain while no section has a host', async () => {
    expect(await sitemapLines('https://feedback.example.com/robots.txt')).toEqual([
      'Sitemap: https://feedback.example.com/sitemap.xml',
      'Sitemap: https://feedback.example.com/hc/sitemap.xml',
    ])
  })

  it("leaves the help center's sitemap off the primary domain once it has its own host", async () => {
    state.origins = { ...allOnPrimary(PRIMARY), help: 'https://help.acme.com' }
    expect(await sitemapLines('https://feedback.example.com/robots.txt')).toEqual([
      'Sitemap: https://feedback.example.com/sitemap.xml',
    ])
  })

  it("advertises only the help center's sitemap on the help center's host", async () => {
    state.origins = { ...allOnPrimary(PRIMARY), help: 'https://help.acme.com' }
    expect(await sitemapLines('https://help.acme.com/robots.txt')).toEqual([
      'Sitemap: https://help.acme.com/hc/sitemap.xml',
    ])
  })

  it("advertises a section host's own sitemap there", async () => {
    state.origins = { ...allOnPrimary(PRIMARY), changelog: 'https://news.acme.com' }
    expect(await sitemapLines('https://news.acme.com/robots.txt')).toEqual([
      'Sitemap: https://news.acme.com/sitemap.xml',
    ])
  })

  it('keeps crawlers off a help center host whose help center is not indexed', async () => {
    state.origins = { ...allOnPrimary(PRIMARY), help: 'https://help.acme.com' }
    state.indexable = false
    const lines = await robots('https://help.acme.com/robots.txt')
    expect(lines).toContain('Disallow: /')
    expect(lines).not.toContain('Allow: /')
    expect(lines.filter((line) => line.startsWith('Sitemap: '))).toEqual([])
  })
})
