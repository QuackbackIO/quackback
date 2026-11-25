// @vitest-environment happy-dom
/**
 * `identityResolved` pin. The Tickets tab is identified-only and hidden when
 * the visitor has none, so the widget must be able to tell "not identified
 * YET" (SDK identify still on its way) from "anonymous" — otherwise it commits
 * to the anonymous bar on mount and never restores the Home landing once a
 * ticket-holding visitor is identified.
 */
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken } from '@/lib/client/widget-auth'

installInMemoryLocalStorage()

vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
const frame = { hasHost: true }
vi.mock('@/lib/client/widget-frame', () => ({ frameHasHost: () => frame.hasHost }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import {
  IDENTITY_HANDSHAKE_TIMEOUT_MS,
  WidgetAuthProvider,
  useWidgetAuth,
} from '../widget-auth-provider'

function Probe() {
  const { identityResolved, isIdentified } = useWidgetAuth()
  return (
    <span data-testid="probe">
      {identityResolved ? 'resolved' : 'pending'}:{isIdentified ? 'identified' : 'anonymous'}
    </span>
  )
}

function HandoffProbe() {
  const { canPortalHandoff, identityResolved } = useWidgetAuth()
  return (
    <span data-testid="handoff">
      {identityResolved ? 'resolved' : 'pending'}:{canPortalHandoff ? 'handoff' : 'veto'}
    </span>
  )
}

function renderWidget(
  props: {
    portalSessionToken?: string | null
    portalUser?: { id: string; name: string; email: string; avatarUrl: string | null } | null
    canPortalHandoff?: boolean
    probe?: ReactNode
  } = {}
) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <WidgetAuthProvider
        portalSessionToken={props.portalSessionToken ?? null}
        portalUser={props.portalUser ?? null}
        canPortalHandoff={props.canPortalHandoff}
      >
        {props.probe ?? <Probe />}
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

describe('WidgetAuthProvider — identityResolved', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    frame.hasHost = true
  })
  afterEach(() => vi.useRealTimers())

  it('resolves as anonymous at once in a frame nobody embeds', async () => {
    frame.hasHost = false
    vi.stubGlobal('fetch', vi.fn())
    renderWidget()
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('resolved:anonymous'))
  })

  it('resolves as anonymous when the host never sends an identity', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
    renderWidget()
    act(() => vi.advanceTimersByTime(IDENTITY_HANDSHAKE_TIMEOUT_MS - 1))
    expect(screen.getByTestId('probe').textContent).toBe('pending:anonymous')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('probe').textContent).toBe('resolved:anonymous')
  })

  it('waits for an identify already on its way, past the handshake wait', async () => {
    vi.useFakeTimers()
    let finish!: (value: unknown) => void
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise((r) => (finish = r)))
    )
    renderWidget()
    postFromHost({ id: 'u1', ssoToken: 'sso' })
    act(() => vi.advanceTimersByTime(IDENTITY_HANDSHAKE_TIMEOUT_MS * 2))
    expect(screen.getByTestId('probe').textContent).toBe('pending:anonymous')
    await act(async () => {
      finish({
        ok: true,
        json: async () => ({
          sessionToken: 'tok',
          user: { id: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null },
        }),
      })
    })
    expect(screen.getByTestId('probe').textContent).toBe('resolved:identified')
  })

  it('still takes an identify that arrives after the handshake wait', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionToken: 'tok',
          user: { id: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null },
        }),
      })
    )
    renderWidget()
    act(() => vi.advanceTimersByTime(IDENTITY_HANDSHAKE_TIMEOUT_MS))
    expect(screen.getByTestId('probe').textContent).toBe('resolved:anonymous')
    postFromHost({ id: 'u1', ssoToken: 'sso' })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(screen.getByTestId('probe').textContent).toBe('resolved:identified')
  })

  it('is pending on mount, before the SDK has identified anyone', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderWidget()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByTestId('probe').textContent).toBe('pending:anonymous')
  })

  it('resolves as anonymous on the SDK anonymous identify', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderWidget()
    postFromHost({ anonymous: true })
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('resolved:anonymous'))
  })

  it('stays pending through the identify round trip, then resolves as identified', async () => {
    let finish!: (value: unknown) => void
    const identifyResponse = new Promise((r) => {
      finish = r
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => identifyResponse)
    )
    renderWidget()
    postFromHost({ id: 'u1', ssoToken: 'sso' })
    await new Promise((r) => setTimeout(r, 0))
    // The named identify is in flight: user is still null but we must NOT
    // read that as "this visitor is anonymous".
    expect(screen.getByTestId('probe').textContent).toBe('pending:anonymous')

    await act(async () => {
      finish({
        ok: true,
        json: async () => ({
          sessionToken: 'tok',
          user: { id: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null },
        }),
      })
    })
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('resolved:identified'))
  })

  it('resolves (as anonymous) when the identify round trip fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { code: 'INVALID' } }) })
    )
    renderWidget()
    postFromHost({ id: 'u1', ssoToken: 'bad' })
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('resolved:anonymous'))
  })

  it('resolves immediately from a portal session', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderWidget({
      portalSessionToken: 'portal-tok',
      portalUser: { id: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null },
    })
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('resolved:identified'))
  })
})

describe('WidgetAuthProvider — canPortalHandoff follows the current identity', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('starts vetoed for a teammate cookie, then follows a customer identify', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionToken: 'tok',
          user: { id: 'cust', name: 'Customer', email: 'c@example.com', avatarUrl: null },
          canPortalHandoff: true,
        }),
      })
    )
    renderWidget({
      portalSessionToken: 'dashboard-tok',
      portalUser: { id: 'admin', name: 'Admin', email: 'a@example.com', avatarUrl: null },
      canPortalHandoff: false,
      probe: <HandoffProbe />,
    })
    await waitFor(() => expect(screen.getByTestId('handoff').textContent).toBe('resolved:veto'))

    postFromHost({ id: 'cust', ssoToken: 'sso' })
    await waitFor(() => expect(screen.getByTestId('handoff').textContent).toBe('resolved:handoff'))
  })
})
