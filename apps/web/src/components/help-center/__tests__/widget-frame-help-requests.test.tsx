// @vitest-environment happy-dom
/**
 * The help center endpoints serve both the portal (cookie session) and the
 * widget. In a widget frame that does not hold the portal session, their
 * requests go without cookies; elsewhere they keep the browser default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const ok = () =>
  new Response(JSON.stringify({ data: { articles: [] } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ok())
  )
})
afterEach(() => vi.unstubAllGlobals())

function lastInit(): RequestInit | undefined {
  const calls = vi.mocked(fetch).mock.calls
  return calls.at(-1)?.[1] as RequestInit | undefined
}

describe('aguiFetchClient', () => {
  it('omits cookies in a widget frame without the portal session', async () => {
    const frame = await import('@/lib/client/widget-frame')
    const { aguiFetchClient } = await import('@/lib/client/utils/agui-fetch')
    frame.setFrameHoldsPortalSession(false)
    await aguiFetchClient()('/api/widget/kb-ask', { method: 'POST' })
    expect(lastInit()).toMatchObject({ method: 'POST', credentials: 'omit' })
  })

  it('leaves the request alone elsewhere', async () => {
    const { aguiFetchClient } = await import('@/lib/client/utils/agui-fetch')
    const init = { method: 'POST' }
    await aguiFetchClient()('/api/widget/kb-ask', init)
    expect(lastInit()).toBe(init)
  })
})

describe('useKbSearch', () => {
  async function search() {
    const { useKbSearch } = await import('../use-kb-search')
    renderHook(() => useKbSearch({ query: 'billing', limit: 3 }))
    await waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 2000 })
    return lastInit()
  }

  it('omits cookies in a widget frame without the portal session', async () => {
    const frame = await import('@/lib/client/widget-frame')
    frame.setFrameHoldsPortalSession(false)
    expect((await search())?.credentials).toBe('omit')
  })

  it('keeps the browser default on the portal', async () => {
    expect((await search())?.credentials).toBeUndefined()
  })
})
