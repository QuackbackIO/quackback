/**
 * An article's tab title and social site name carry the workspace name. The
 * portal loader returns `workspaceName`; a missing name falls back to "Help Center".
 */
import { describe, expect, it } from 'vitest'

const { Route } = await import('../_portal/hc/$locale/articles/$idSlug/index')

type Head = (ctx: {
  loaderData?: Record<string, unknown>
  params: Record<string, string>
  matches: Array<{ routeId: string; loaderData?: unknown; context?: unknown }>
}) => { meta?: Array<Record<string, string>>; links?: Array<Record<string, string>> }
const head = (Route as unknown as { options: { head: Head } }).options.head

const article = {
  id: 'art_150',
  urlId: 150,
  slug: 'mcp-reference',
  title: 'MCP tool reference',
  description: 'Every tool the MCP server exposes.',
  content: null,
}

function headFor(workspaceName: string) {
  return head({
    loaderData: { article },
    params: { locale: 'en', idSlug: '150-mcp-reference' },
    matches: [
      {
        routeId: '/_portal',
        loaderData: { workspaceName },
        context: { baseUrl: 'https://feedback.example.com' },
      },
    ],
  })
}

describe('help center article head', () => {
  it('titles the article with the workspace name', () => {
    const { meta } = headFor('Acme')
    expect(meta?.find((m) => 'title' in m)?.title).toBe('MCP tool reference - Acme')
  })

  it('names the workspace as the social site name and title', () => {
    const { meta } = headFor('Acme')
    expect(meta?.find((m) => m.property === 'og:site_name')?.content).toBe('Acme')
    expect(meta?.find((m) => m.property === 'og:title')?.content).toBe('MCP tool reference - Acme')
  })

  it('never falls back to the generic "Help Center" label', () => {
    const { meta } = headFor('Acme')
    expect(JSON.stringify(meta)).not.toContain('Help Center')
  })

  it('canonicalises to the article URL on the request base', () => {
    const { links } = headFor('Acme')
    expect(links).toContainEqual({
      rel: 'canonical',
      href: 'https://feedback.example.com/hc/en/articles/150-mcp-reference',
    })
  })

  it('omits the canonical when the request has no base URL', () => {
    const { links } = head({
      loaderData: { article },
      params: { locale: 'en', idSlug: '150-mcp-reference' },
      matches: [{ routeId: '/_portal', loaderData: { workspaceName: 'Acme' }, context: {} }],
    })
    expect(links).toEqual([])
  })
})
