// @vitest-environment node
/**
 * robots.txt advertises the help center sitemap where it lives. Once a custom
 * domain is verified, the default host's /hc/sitemap.xml redirects there, so
 * the advertised link points at the custom domain directly, whichever host
 * served robots.txt. The help center's domain is its entry in the section map.
 */
import { describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sectionDomains: {} as Record<string, { hostname: string; verifiedAt: string | null }>,
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
    seo: { indexable: true },
    // The setting the map replaced, still stored: the map wins over it.
    domain: { domain: 'old-help.acme.com', verifiedAt: '2026-09-01T00:00:00.000Z' },
  }),
}))

vi.mock('@/lib/server/domains/settings/section-domains.service', () => ({
  getSectionDomains: async () => state.sectionDomains,
}))

import { Route } from '../robots[.]txt'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
const { GET } = (Route as unknown as { options: { server: { handlers: Handlers } } }).options.server
  .handlers

async function sitemapLines(requestUrl: string): Promise<string[]> {
  const response = await GET({ request: new Request(requestUrl) })
  const body = await response.text()
  return body.split('\n').filter((line) => line.startsWith('Sitemap: '))
}

const verified = { help: { hostname: 'help.acme.com', verifiedAt: '2026-10-01T00:00:00.000Z' } }

describe('robots.txt sitemap lines', () => {
  it('advertises the help center sitemap on the base URL without a custom domain', async () => {
    state.sectionDomains = {}
    expect(await sitemapLines('https://feedback.example.com/robots.txt')).toEqual([
      'Sitemap: https://feedback.example.com/sitemap.xml',
      'Sitemap: https://feedback.example.com/hc/sitemap.xml',
    ])
  })

  it('keeps the base URL while the custom domain is not verified', async () => {
    state.sectionDomains = { help: { hostname: 'help.acme.com', verifiedAt: null } }
    expect(await sitemapLines('https://feedback.example.com/robots.txt')).toEqual([
      'Sitemap: https://feedback.example.com/sitemap.xml',
      'Sitemap: https://feedback.example.com/hc/sitemap.xml',
    ])
  })

  it('advertises the verified custom domain when robots.txt is served on the default host', async () => {
    state.sectionDomains = verified
    expect(await sitemapLines('https://feedback.example.com/robots.txt')).toEqual([
      'Sitemap: https://feedback.example.com/sitemap.xml',
      'Sitemap: https://help.acme.com/hc/sitemap.xml',
    ])
  })

  it('advertises the verified custom domain when robots.txt is served on it', async () => {
    state.sectionDomains = verified
    expect(await sitemapLines('https://help.acme.com/robots.txt')).toEqual([
      'Sitemap: https://feedback.example.com/sitemap.xml',
      'Sitemap: https://help.acme.com/hc/sitemap.xml',
    ])
  })
})
