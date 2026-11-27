import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => ({ headers: new Headers() }))
const identity = vi.hoisted(() => ({ treatRequestAsAnonymous: vi.fn() }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = { validator: () => chain, handler: (fn: () => unknown) => fn }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => request.headers }))
vi.mock('@/lib/server/auth/request-session', () => identity)

const { widgetPortalSessionReusedFn } = await import('../portal-session')

describe('widgetPortalSessionReusedFn', () => {
  beforeEach(() => identity.treatRequestAsAnonymous.mockClear())

  it('keeps the request identity for a same-origin frame navigation', async () => {
    request.headers = new Headers({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' })
    expect(await widgetPortalSessionReusedFn()).toBe(true)
    expect(identity.treatRequestAsAnonymous).not.toHaveBeenCalled()
  })

  it.each([
    [{ 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' }],
    [{ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }],
    [{}],
  ])('serves the rest of the request as anonymous for %j', async (headers) => {
    request.headers = new Headers(headers)
    expect(await widgetPortalSessionReusedFn()).toBe(false)
    expect(identity.treatRequestAsAnonymous).toHaveBeenCalledTimes(1)
  })
})
