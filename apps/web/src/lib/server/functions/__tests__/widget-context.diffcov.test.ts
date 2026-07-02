import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ origin: 'https://example.com' }),
}))

const mockResolveWidgetContext = vi.fn()
vi.mock('@/lib/server/widget/context', () => ({
  resolveWidgetContext: (...args: unknown[]) => mockResolveWidgetContext(...args),
}))

const RESOLVE_WIDGET_CONTEXT = 0
let resolveWidgetContextHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../widget-context')
  }
  resolveWidgetContextHandler = handlersByIndex[RESOLVE_WIDGET_CONTEXT]
})

describe('resolveWidgetContextFn', () => {
  it('builds a request from the headers and maps the resolved context fields', async () => {
    const resolved = {
      source: 'profile',
      profileId: 'wp_1',
      applicationKey: 'app-key',
      environment: 'production',
      publicConfig: { foo: 'bar' },
      contentFilters: { feedback: { boardIds: ['board_1'] } },
      supportConfig: { allowChat: true },
      contextToken: 'tok_abc',
      denialReason: undefined,
      // Extra fields that must NOT appear in the mapped result.
      claims: { iat: 1, exp: 2 },
    }
    mockResolveWidgetContext.mockResolvedValue(resolved)

    const data = {
      applicationKey: 'app-key',
      environment: 'production',
      hostOrigin: 'https://example.com',
    }
    const result = (await resolveWidgetContextHandler({ data })) as Record<string, unknown>

    // The handler must forward the request + data to the resolver.
    expect(mockResolveWidgetContext).toHaveBeenCalledTimes(1)
    const [req, passedData] = mockResolveWidgetContext.mock.calls[0]
    expect(req).toBeInstanceOf(Request)
    expect(passedData).toBe(data)

    expect(result).toEqual({
      source: 'profile',
      profileId: 'wp_1',
      applicationKey: 'app-key',
      environment: 'production',
      publicConfig: { foo: 'bar' },
      contentFilters: { feedback: { boardIds: ['board_1'] } },
      supportConfig: { allowChat: true },
      contextToken: 'tok_abc',
      denialReason: undefined,
    })
    // No leaking of internal claims.
    expect(result).not.toHaveProperty('claims')
  })

  it('passes through a denial reason from the resolver', async () => {
    mockResolveWidgetContext.mockResolvedValue({
      source: 'disabled',
      profileId: undefined,
      applicationKey: undefined,
      environment: undefined,
      publicConfig: {},
      contentFilters: {},
      supportConfig: {},
      contextToken: '',
      denialReason: 'origin_denied',
    })

    const result = (await resolveWidgetContextHandler({ data: {} })) as Record<string, unknown>

    expect(result.source).toBe('disabled')
    expect(result.denialReason).toBe('origin_denied')
  })
})
