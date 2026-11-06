/**
 * A collection page is titled and described as itself, not as the portal, and
 * canonicalises to its own URL, the same shape an article page uses.
 */
import { describe, expect, it } from 'vitest'

const { Route } = await import('../_portal/hc/$locale/collections/$idSlug')

type Head = (ctx: {
  loaderData?: Record<string, unknown>
  params: Record<string, string>
  matches: Array<{ routeId: string; loaderData?: unknown; context?: unknown }>
}) => {
  meta?: Array<Record<string, string>>
  links?: Array<Record<string, string>>
}
const head = (Route as unknown as { options: { head: Head } }).options.head

const category = {
  id: 'cat_4',
  urlId: 4,
  slug: 'boards-portal',
  name: 'Boards',
  description: 'Set up the boards your visitors post to.',
}

function headFor(cat: Record<string, unknown>) {
  return head({
    loaderData: { category: cat },
    params: { locale: 'en', idSlug: '4-boards-portal' },
    matches: [
      {
        routeId: '/_portal',
        loaderData: { workspaceName: 'Acme' },
        context: { baseUrl: 'https://feedback.example.com' },
      },
    ],
  })
}

describe('help center collection head', () => {
  it('titles the collection with the workspace name', () => {
    const { meta } = headFor(category)
    expect(meta?.find((m) => 'title' in m)?.title).toBe('Boards - Acme')
  })

  it('uses the collection description and social tags, not the portal copy', () => {
    const { meta } = headFor(category)
    expect(meta?.find((m) => m.name === 'description')?.content).toBe(
      'Set up the boards your visitors post to.'
    )
    expect(meta?.find((m) => m.property === 'og:title')?.content).toBe('Boards - Acme')
    expect(meta?.find((m) => m.property === 'og:description')?.content).toBe(
      'Set up the boards your visitors post to.'
    )
    expect(meta?.find((m) => m.property === 'og:site_name')?.content).toBe('Acme')
  })

  it('canonicalises to the collection URL on the request base', () => {
    const { links } = headFor(category)
    expect(links).toContainEqual({
      rel: 'canonical',
      href: 'https://feedback.example.com/hc/en/collections/4-boards-portal',
    })
  })

  it('omits the description when the collection has none', () => {
    const { meta } = headFor({ ...category, description: null })
    expect(meta?.find((m) => m.name === 'description')).toBeUndefined()
  })

  it('omits the canonical and og:url when the request has no base URL', () => {
    const { meta, links } = head({
      loaderData: { category },
      params: { locale: 'en', idSlug: '4-boards-portal' },
      matches: [{ routeId: '/_portal', loaderData: { workspaceName: 'Acme' }, context: {} }],
    })
    expect(links).toEqual([])
    expect(meta?.find((m) => m.property === 'og:url')).toBeUndefined()
  })
})
