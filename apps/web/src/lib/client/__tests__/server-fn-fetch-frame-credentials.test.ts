// @vitest-environment happy-dom
/**
 * A widget frame that does not hold the visitor's portal session makes its
 * server function calls without cookies. Every other page, and a frame that
 * holds the session, keeps the call's own credentials.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ok = () => new Response('{}', { status: 200, headers: { 'x-tss-serialized': 'true' } })

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ok())
  )
})
afterEach(() => vi.unstubAllGlobals())

async function load() {
  const frame = await import('../widget-frame')
  const { serverFnFetch } = await import('../server-fn-fetch')
  return { frame, serverFnFetch }
}

describe('serverFnFetch credentials in a widget frame', () => {
  it('omits cookies when the frame does not hold the portal session', async () => {
    const { frame, serverFnFetch } = await load()
    frame.setFrameHoldsPortalSession(false)
    await serverFnFetch('/_serverFn/x', { method: 'POST' })
    expect(fetch).toHaveBeenCalledWith('/_serverFn/x', { method: 'POST', credentials: 'omit' })
  })

  it('keeps the call unchanged when the frame holds the portal session', async () => {
    const { frame, serverFnFetch } = await load()
    frame.setFrameHoldsPortalSession(true)
    const init = { method: 'POST' }
    await serverFnFetch('/_serverFn/x', init)
    expect(fetch).toHaveBeenCalledWith('/_serverFn/x', init)
  })

  it('keeps the call unchanged on pages that are not a widget frame', async () => {
    const { serverFnFetch } = await load()
    await serverFnFetch('/_serverFn/x')
    expect(fetch).toHaveBeenCalledWith('/_serverFn/x', undefined)
  })
})

describe('frameParentIsSameOrigin', () => {
  it('is true for the top page', async () => {
    const { frame } = await load()
    expect(frame.frameParentIsSameOrigin()).toBe(true)
  })

  it('is true for a readable parent on the same origin', async () => {
    vi.stubGlobal('parent', { location: { origin: window.location.origin } })
    const { frame } = await load()
    expect(frame.frameParentIsSameOrigin()).toBe(true)
  })

  it('is false for a parent on another origin', async () => {
    vi.stubGlobal('parent', { location: { origin: 'https://other.example' } })
    const { frame } = await load()
    expect(frame.frameParentIsSameOrigin()).toBe(false)
  })

  it('is false when reading the parent throws (cross-origin)', async () => {
    vi.stubGlobal('parent', {
      get location(): never {
        throw new DOMException('Blocked a frame', 'SecurityError')
      },
    })
    const { frame } = await load()
    expect(frame.frameParentIsSameOrigin()).toBe(false)
  })
})
