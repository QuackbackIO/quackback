// @vitest-environment happy-dom
/**
 * The frame adopts a portal session the server hands it only when its parent
 * page is on its own origin (or it is the top page): a navigation the frame
 * starts itself looks same-origin to the server whoever embeds it. A host on
 * an opaque origin gets a refused identify without any identify request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'

installInMemoryLocalStorage()

const bridge = vi.hoisted(() => ({
  sendToHost: vi.fn(),
  hostOriginIsOpaque: vi.fn(() => false),
}))
vi.mock('@/lib/client/widget-bridge', () => bridge)
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

const portalUser = { id: 'user_1', name: 'Ada', email: 'ada@example.com', avatarUrl: null }

async function renderWidget() {
  const { WidgetAuthProvider, useWidgetAuth } = await import('../widget-auth-provider')
  const widgetAuth = await import('@/lib/client/widget-auth')
  const frame = await import('@/lib/client/widget-frame')
  const seen: { current: ReturnType<typeof useWidgetAuth> | null } = { current: null }
  function Probe() {
    seen.current = useWidgetAuth()
    return null
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WidgetAuthProvider portalSessionToken="portal-tok" portalUser={portalUser}>
        <Probe />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { seen, widgetAuth, frame }
}

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  bridge.sendToHost.mockClear()
  bridge.hostOriginIsOpaque.mockReturnValue(false)
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('WidgetAuthProvider: the frame parent decides portal session adoption', () => {
  it('adopts it under a same-origin parent', async () => {
    vi.stubGlobal('parent', { postMessage: vi.fn(), location: { origin: window.location.origin } })
    const { seen, widgetAuth, frame } = await renderWidget()
    expect(widgetAuth.getWidgetToken()).toBe('portal-tok')
    expect(seen.current?.user).toEqual(portalUser)
    expect(frame.frameHoldsPortalSession()).toBe(true)
    expect(bridge.sendToHost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quackback:auth-change', user: portalUser })
    )
  })

  it('does not adopt it, or send the user, under a cross-origin parent', async () => {
    vi.stubGlobal('parent', {
      postMessage: vi.fn(),
      get location(): never {
        throw new DOMException('Blocked a frame', 'SecurityError')
      },
    })
    const { seen, widgetAuth, frame } = await renderWidget()
    expect(widgetAuth.getWidgetToken()).toBeNull()
    expect(seen.current?.user).toBeNull()
    expect(seen.current?.sessionVersion).toBe(0)
    expect(frame.frameHoldsPortalSession()).toBe(false)
    expect(frame.frameRequestCredentials()).toBe('omit')
    expect(bridge.sendToHost).not.toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.anything() })
    )
  })
})

describe('WidgetAuthProvider: a host on an opaque origin', () => {
  it('refuses a named identify without calling the server or changing the session', async () => {
    bridge.hostOriginIsOpaque.mockReturnValue(true)
    const { seen, widgetAuth } = await renderWidget()
    const tokenBefore = widgetAuth.getWidgetToken()
    const versionBefore = seen.current?.sessionVersion
    bridge.sendToHost.mockClear()

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:identify', data: { ssoToken: 'signed' } },
        source: window.parent as MessageEventSource,
      })
    )
    await waitFor(() =>
      expect(bridge.sendToHost).toHaveBeenCalledWith({
        type: 'quackback:identify-result',
        success: false,
        error: 'HOST_ORIGIN_UNKNOWN',
      })
    )
    expect(fetch).not.toHaveBeenCalledWith('/api/widget/identify', expect.anything())
    expect(widgetAuth.getWidgetToken()).toBe(tokenBefore)
    expect(seen.current?.sessionVersion).toBe(versionBefore)
    expect(seen.current?.identityResolved).toBe(true)
  })
})
