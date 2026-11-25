// @vitest-environment happy-dom
/**
 * The widget loader re-runs on the client (Retry, router invalidation) without
 * the portal session: only the frame's document request may carry it. The
 * provider keeps the portal session and user it was first given, so a re-run
 * never signs the visitor out or reports a change to the host.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken, getWidgetToken } from '@/lib/client/widget-auth'

installInMemoryLocalStorage()

const bridge = vi.hoisted(() => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/widget-bridge', () => bridge)
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider, useWidgetAuth } from '../widget-auth-provider'

const portalUser = { id: 'user_1', name: 'Ada', email: 'ada@example.com', avatarUrl: null }
let seen: ReturnType<typeof useWidgetAuth> | null = null

function Probe() {
  seen = useWidgetAuth()
  return null
}

function tree(props: { portalSessionToken: string | null; portalUser: typeof portalUser | null }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WidgetAuthProvider {...props}>
        <Probe />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

let queryClient: QueryClient

describe('WidgetAuthProvider: a loader re-run without the portal session', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    bridge.sendToHost.mockClear()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seen = null
  })

  it('keeps the first portal session and user', async () => {
    const view = render(tree({ portalSessionToken: 'portal-tok', portalUser }))
    await waitFor(() => expect(seen?.user).toEqual(portalUser))
    const version = seen!.sessionVersion

    view.rerender(tree({ portalSessionToken: null, portalUser: null }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(seen!.user).toEqual(portalUser)
    expect(seen!.sessionVersion).toBe(version)
    expect(getWidgetToken()).toBe('portal-tok')
    expect(bridge.sendToHost).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quackback:auth-change', user: null })
    )
  })

  it('lets an anonymous identify defer to the kept portal session', async () => {
    const view = render(tree({ portalSessionToken: 'portal-tok', portalUser }))
    await waitFor(() => expect(seen?.user).toEqual(portalUser))
    view.rerender(tree({ portalSessionToken: null, portalUser: null }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:identify', data: { anonymous: true } },
        source: window.parent as MessageEventSource,
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(seen!.user).toEqual(portalUser)
    expect(getWidgetToken()).toBe('portal-tok')
  })
})
