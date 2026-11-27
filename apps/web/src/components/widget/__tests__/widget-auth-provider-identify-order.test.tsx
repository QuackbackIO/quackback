// @vitest-environment happy-dom
/**
 * The latest identify from the host wins. A round trip that settles after a
 * logout or a newer identify must not sign its user back in, which is what a
 * host switching users (logout, then identify the next person) relies on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken, getWidgetToken, setWidgetToken } from '@/lib/client/widget-auth'
import { sendToHost } from '@/lib/client/widget-bridge'

installInMemoryLocalStorage()

vi.mock('@/lib/client/widget-bridge', () => ({
  sendToHost: vi.fn(),
  hostOriginIsOpaque: () => false,
}))
vi.mock('@/lib/client/widget-frame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/widget-frame')>()),
  frameHasHost: () => true,
}))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider, useWidgetAuth } from '../widget-auth-provider'

function Probe() {
  const { identityResolved, user } = useWidgetAuth()
  return <span data-testid="probe">{identityResolved ? (user?.id ?? 'anonymous') : 'pending'}</span>
}

function renderWidget() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WidgetAuthProvider portalSessionToken={null} portalUser={null}>
        <Probe />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

function postFromHost(data: unknown) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:identify', data },
        source: window.parent,
      })
    )
  })
}

const person = (id: string) => ({ id, name: id, email: `${id}@example.com`, avatarUrl: null })
const signedIn = (id: string) => ({
  ok: true,
  json: async () => ({ sessionToken: `token-${id}`, user: person(id) }),
})

// Holds each identify request open until the test settles it, keyed by ssoToken.
function deferredIdentify() {
  const settle: Record<string, (response: unknown) => void> = {}
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: { body: string }) => {
      const { ssoToken } = JSON.parse(init.body) as { ssoToken: string }
      return new Promise((resolve) => (settle[ssoToken] = resolve))
    })
  )
  return settle
}

const identifyResults = () =>
  vi
    .mocked(sendToHost)
    .mock.calls.map(([msg]) => msg as { type: string; user?: { id: string } | null })
    .filter((msg) => msg.type === 'quackback:identify-result')

describe('WidgetAuthProvider: the latest identify wins', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.mocked(sendToHost).mockClear()
  })

  it('a logout while identify is in flight stays logged out', async () => {
    const settle = deferredIdentify()
    renderWidget()
    postFromHost({ ssoToken: 'a' })
    postFromHost(null)
    await act(async () => settle.a(signedIn('a')))

    expect(getWidgetToken()).toBeNull()
    expect(screen.getByTestId('probe').textContent).toBe('anonymous')
    expect(identifyResults().map((m) => m.user?.id ?? null)).toEqual([null])
  })

  it('switching users keeps the newer user when the older reply lands last', async () => {
    const settle = deferredIdentify()
    renderWidget()
    postFromHost({ ssoToken: 'a' })
    postFromHost(null)
    postFromHost({ ssoToken: 'b' })
    await act(async () => settle.b(signedIn('b')))
    await act(async () => settle.a(signedIn('a')))

    expect(getWidgetToken()).toBe('token-b')
    expect(screen.getByTestId('probe').textContent).toBe('b')
    expect(identifyResults().map((m) => m.user?.id ?? null)).toEqual([null, 'b'])
  })

  it('a superseded identify that fails reports nothing', async () => {
    const settle = deferredIdentify()
    renderWidget()
    postFromHost({ ssoToken: 'a' })
    postFromHost({ ssoToken: 'b' })
    await act(async () => settle.b(signedIn('b')))
    await act(async () =>
      settle.a({ ok: false, json: async () => ({ error: { code: 'TOKEN_EXPIRED' } }) })
    )

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('b'))
    expect(identifyResults().map((m) => m.user?.id ?? null)).toEqual(['b'])
  })

  it('a failed identify signs out whoever was signed in before', async () => {
    const settle = deferredIdentify()
    renderWidget()
    postFromHost({ ssoToken: 'a' })
    await act(async () => settle.a(signedIn('a')))
    expect(getWidgetToken()).toBe('token-a')

    postFromHost({ ssoToken: 'b' })
    await act(async () =>
      settle.b({ ok: false, json: async () => ({ error: { code: 'TOKEN_EXPIRED' } }) })
    )

    expect(getWidgetToken()).toBeNull()
    expect(screen.getByTestId('probe').textContent).toBe('anonymous')
    expect(identifyResults().at(-1)).toMatchObject({ success: false, error: 'TOKEN_EXPIRED' })
  })

  it("a failed identify keeps an anonymous visitor's session", async () => {
    const settle = deferredIdentify()
    renderWidget()
    // An anonymous session the visitor already has (minted on a first vote).
    setWidgetToken('anonymous-token')
    postFromHost({ ssoToken: 'b' })
    await act(async () => settle.b({ ok: false, json: async () => ({}) }))

    expect(getWidgetToken()).toBe('anonymous-token')
    expect(identifyResults().at(-1)).toMatchObject({ success: false, error: 'SERVER_ERROR' })
  })
})
