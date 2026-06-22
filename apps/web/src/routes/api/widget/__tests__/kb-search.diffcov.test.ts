/**
 * Differential-coverage tests for `GET /api/widget/kb-search`.
 *
 * Drives the feature-flag gate, the empty-query short-circuit, the content
 * filter logic (category + article allow-lists) and the catch branch
 * (mapped domain error vs. generic 500).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be declared before importing the route under test.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn(),
}))

const hybridSearchMock = vi.fn()
vi.mock('@/lib/server/domains/help-center/help-center-search.service', () => ({
  hybridSearch: (...args: unknown[]) => hybridSearchMock(...args),
}))

const getWidgetRequestContextMock = vi.fn()
// Define WidgetContextError INSIDE the (hoisted) factory so `cors.ts`, which
// imports it from this same mocked module, matches via `instanceof`. We grab a
// reference to construct instances in tests via the mocked import below.
vi.mock('@/lib/server/widget/context', () => {
  class WidgetContextError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.name = 'WidgetContextError'
      this.code = code
    }
  }
  return {
    getWidgetRequestContext: (...args: unknown[]) => getWidgetRequestContextMock(...args),
    WidgetContextError,
  }
})

const errorMock = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: (...args: unknown[]) => errorMock(...args) }) },
}))

import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { WidgetContextError } from '@/lib/server/widget/context'
import { Route } from '../kb-search'

type Handler = (ctx: { request: Request }) => Promise<Response>
type RouteShape = { options: { server: { handlers: Record<string, Handler> } } }
const handlers = (Route as unknown as RouteShape).options.server.handlers

const makeReq = (qs: string) => new Request(`http://localhost/api/widget/kb-search${qs}`)

const emptyContext = { claims: null, contentFilters: {}, supportConfig: {} }

beforeEach(() => {
  vi.clearAllMocks()
  getWidgetRequestContextMock.mockResolvedValue(emptyContext)
})

describe('GET /api/widget/kb-search', () => {
  it('returns 404 when the help center feature is disabled', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(false)
    const res = await handlers.GET({ request: makeReq('?q=hello') })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(hybridSearchMock).not.toHaveBeenCalled()
  })

  it('returns empty articles when query is blank (whitespace trimmed)', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    const res = await handlers.GET({ request: makeReq('?q=%20%20') })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { articles: [] } })
    expect(hybridSearchMock).not.toHaveBeenCalled()
  })

  it('returns empty articles when query param is missing', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    const res = await handlers.GET({ request: makeReq('') })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { articles: [] } })
  })

  it('maps search results and clamps the limit to 20', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    hybridSearchMock.mockResolvedValueOnce([
      {
        id: 'hca_1',
        slug: 'getting-started',
        title: 'Getting Started',
        content: 'x'.repeat(500),
        categoryId: 'hcc_1',
        categorySlug: 'general',
        categoryName: 'General',
      },
    ])
    const res = await handlers.GET({ request: makeReq('?q=start&limit=999') })
    expect(res.status).toBe(200)
    // limit clamped to 20
    expect(hybridSearchMock).toHaveBeenCalledWith('start', 20)
    const json = (await res.json()) as {
      data: { articles: Array<{ id: string; content: string; category: { id: string } }> }
    }
    expect(json.data.articles).toHaveLength(1)
    expect(json.data.articles[0].id).toBe('hca_1')
    // content truncated to 200 chars
    expect(json.data.articles[0].content).toHaveLength(200)
    expect(json.data.articles[0].category.id).toBe('hcc_1')
  })

  it('handles a result with no content (defaults to empty string)', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    hybridSearchMock.mockResolvedValueOnce([
      {
        id: 'hca_2',
        slug: 's',
        title: 'No content',
        content: null,
        categoryId: 'hcc_2',
        categorySlug: 'c',
        categoryName: 'C',
      },
    ])
    const res = await handlers.GET({ request: makeReq('?q=x&limit=5') })
    expect(hybridSearchMock).toHaveBeenCalledWith('x', 5)
    const json = (await res.json()) as { data: { articles: Array<{ content: string }> } }
    expect(json.data.articles[0].content).toBe('')
  })

  it('filters out articles whose category is not in the allow-list', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    getWidgetRequestContextMock.mockResolvedValueOnce({
      claims: null,
      contentFilters: { help: { categoryIds: ['hcc_allowed'] } },
      supportConfig: {},
    })
    hybridSearchMock.mockResolvedValueOnce([
      { id: 'hca_a', slug: 'a', title: 'A', content: 'a', categoryId: 'hcc_allowed' },
      { id: 'hca_b', slug: 'b', title: 'B', content: 'b', categoryId: 'hcc_blocked' },
    ])
    const res = await handlers.GET({ request: makeReq('?q=q') })
    const json = (await res.json()) as { data: { articles: Array<{ id: string }> } }
    expect(json.data.articles.map((a) => a.id)).toEqual(['hca_a'])
  })

  it('filters out articles whose id is not in the article allow-list', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    getWidgetRequestContextMock.mockResolvedValueOnce({
      claims: null,
      contentFilters: { help: { articleIds: ['hca_keep'] } },
      supportConfig: {},
    })
    hybridSearchMock.mockResolvedValueOnce([
      { id: 'hca_keep', slug: 'k', title: 'Keep', content: 'k', categoryId: 'hcc_1' },
      { id: 'hca_drop', slug: 'd', title: 'Drop', content: 'd', categoryId: 'hcc_1' },
    ])
    const res = await handlers.GET({ request: makeReq('?q=q') })
    const json = (await res.json()) as { data: { articles: Array<{ id: string }> } }
    expect(json.data.articles.map((a) => a.id)).toEqual(['hca_keep'])
  })

  it('applies both category and article allow-lists together', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    getWidgetRequestContextMock.mockResolvedValueOnce({
      claims: null,
      contentFilters: { help: { categoryIds: ['hcc_ok'], articleIds: ['hca_ok'] } },
      supportConfig: {},
    })
    hybridSearchMock.mockResolvedValueOnce([
      // passes both filters
      { id: 'hca_ok', slug: 'ok', title: 'Ok', content: 'ok', categoryId: 'hcc_ok' },
      // right category, wrong article
      { id: 'hca_no', slug: 'no', title: 'No', content: 'no', categoryId: 'hcc_ok' },
      // wrong category
      { id: 'hca_ok', slug: 'x', title: 'X', content: 'x', categoryId: 'hcc_bad' },
    ])
    const res = await handlers.GET({ request: makeReq('?q=q') })
    const json = (await res.json()) as { data: { articles: Array<{ id: string }> } }
    expect(json.data.articles.map((a) => a.id)).toEqual(['hca_ok'])
  })
})

describe('GET /api/widget/kb-search — error handling', () => {
  it('maps a WidgetContextError to its HTTP response (403)', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    getWidgetRequestContextMock.mockRejectedValueOnce(
      new WidgetContextError('INVALID_WIDGET_CONTEXT', 'bad token')
    )
    const res = await handlers.GET({ request: makeReq('?q=q') })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_WIDGET_CONTEXT' } })
    expect(errorMock).not.toHaveBeenCalled()
  })

  it('returns 500 SERVER_ERROR and logs on an unmapped error', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true)
    hybridSearchMock.mockRejectedValueOnce(new Error('search exploded'))
    const res = await handlers.GET({ request: makeReq('?q=q') })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: { code: 'SERVER_ERROR' } })
    expect(errorMock).toHaveBeenCalled()
  })
})
