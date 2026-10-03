// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import {
  getWidgetToken,
  clearWidgetToken,
  persistAnonymousToken,
  readPersistedToken,
} from '@/lib/client/widget-auth'

installInMemoryLocalStorage()

vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider, useWidgetAuth } from '../widget-auth-provider'
import { authClient } from '@/lib/client/auth-client'
import { sendToHost } from '@/lib/client/widget-bridge'

const mintAnon = vi.mocked(authClient.signIn.anonymous)

function Probe() {
  const { testSession, canPortalHandoff, ensureSession, sessionVersion } = useWidgetAuth()
  return (
    <>
      <span data-testid="probe">
        {testSession ? 'test' : 'none'}:{canPortalHandoff ? 'handoff' : 'veto'}
      </span>
      <button onClick={() => void ensureSession()}>write</button>
      <span data-testid="version">{sessionVersion}</span>
    </>
  )
}

function renderTestFrame() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WidgetAuthProvider testMode portalSessionToken={null}>
        <Probe />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

function post(type: string, data: unknown, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type, data }, origin, source: window.parent })
    )
  })
}

function exchangeOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { sessionToken: 'customer-session-1', testSession: true } }),
  })
}

describe('WidgetAuthProvider in a test frame', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    mintAnon.mockClear()
    vi.mocked(sendToHost).mockClear()
    vi.unstubAllGlobals()
  })

  it('never restores the shared persisted token or mints an anonymous session', async () => {
    persistAnonymousToken('real-visitor')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderTestFrame()
    act(() => screen.getByText('write').click())
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mintAnon).not.toHaveBeenCalled()
    expect(getWidgetToken()).toBeNull()
    expect(readPersistedToken()).toBe('real-visitor')
  })

  it('adopts the exchanged Bearer in memory only and vetoes the portal handoff', async () => {
    const fetchMock = exchangeOk()
    vi.stubGlobal('fetch', fetchMock)
    renderTestFrame()
    post('quackback:test-token', 'customer-abc')
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('test:veto'))
    expect(getWidgetToken()).toBe('customer-session-1')
    expect(readPersistedToken()).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/widget/test-session',
      expect.objectContaining({
        credentials: 'omit',
        body: JSON.stringify({ token: 'customer-abc' }),
      })
    )
  })

  it('ignores a token posted from another origin', async () => {
    const fetchMock = exchangeOk()
    vi.stubGlobal('fetch', fetchMock)
    renderTestFrame()
    post('quackback:test-token', 'customer-abc', 'https://elsewhere.example.com')
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getWidgetToken()).toBeNull()
  })

  it('keeps the test session when the host asks to identify someone else', async () => {
    const fetchMock = exchangeOk()
    vi.stubGlobal('fetch', fetchMock)
    renderTestFrame()
    post('quackback:test-token', 'customer-abc')
    await waitFor(() => expect(getWidgetToken()).toBe('customer-session-1'))
    post('quackback:identify', null)
    post('quackback:identify', { ssoToken: 'signed' })
    await new Promise((r) => setTimeout(r, 0))
    expect(getWidgetToken()).toBe('customer-session-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('announces a stable document identity and coalesces duplicate tokens while exchanging', async () => {
    let resolveExchange!: (value: { ok: boolean; json: () => Promise<unknown> }) => void
    const response = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveExchange = resolve
    })
    const fetchMock = vi.fn((url: string, options: RequestInit) => {
      expect(url).toBe('/api/widget/test-session')
      expect(JSON.parse(String(options.body))).toEqual({ token: 'customer-once' })
      return response
    })
    vi.stubGlobal('fetch', fetchMock)
    renderTestFrame()
    const ready = vi
      .mocked(sendToHost)
      .mock.calls.find(([message]) => message.type === 'quackback:ready')?.[0]
    expect(ready?.documentId).toEqual(expect.any(String))
    const initialVersion = Number(screen.getByTestId('version').textContent)
    post('quackback:test-token', 'customer-once')
    post('quackback:test-token', 'customer-once')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () =>
      resolveExchange({
        ok: true,
        json: async () => ({ data: { sessionToken: 'customer-session-once', testSession: true } }),
      })
    )
    await waitFor(() => expect(getWidgetToken()).toBe('customer-session-once'))
    expect(Number(screen.getByTestId('version').textContent)).toBe(initialVersion + 1)
    expect(
      vi
        .mocked(sendToHost)
        .mock.calls.filter(([message]) => message.type === 'quackback:test-session')
    ).toEqual([[{ type: 'quackback:test-session', success: true, documentId: ready?.documentId }]])
    expect(mintAnon).not.toHaveBeenCalled()
    expect(readPersistedToken()).toBeNull()
  })

  it('ignores a pending token delivery meant for the previous frame document', async () => {
    const fetchMock = exchangeOk()
    vi.stubGlobal('fetch', fetchMock)
    renderTestFrame()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'quackback:test-token',
            data: 'customer-previous-document',
            documentId: 'previous-document',
          },
          origin: window.location.origin,
          source: window.parent,
        })
      )
    })
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getWidgetToken()).toBeNull()
    expect(mintAnon).not.toHaveBeenCalled()
  })
})
