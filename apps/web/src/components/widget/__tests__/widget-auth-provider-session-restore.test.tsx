// @vitest-environment happy-dom
/**
 * Reload-continuity regression pin (support-inbox plan P0.3).
 *
 * P0.1 persists an anonymous session token to iframe-origin localStorage and,
 * on mount, restores it — validating via GET /api/widget/session before adopting
 * it — so a returning visitor's conversation survives a reload instead of being
 * orphaned under a freshly minted principal. This pins that behavior at the
 * auth-provider layer:
 *   - a still-valid persisted token is adopted WITHOUT minting a new session,
 *   - a token the server rejects (401) is dropped and nothing is adopted,
 *   - with no persisted token the widget stays lazy (no validate, no mint),
 *   - a portal session takes precedence over restore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
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

import { WidgetAuthProvider } from '../widget-auth-provider'
import { authClient } from '@/lib/client/auth-client'

const mintAnon = vi.mocked(authClient.signIn.anonymous)

function renderWidget(props: { portalSessionToken?: string | null } = {}) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <WidgetAuthProvider portalSessionToken={props.portalSessionToken ?? null}>
        <span data-testid="probe" />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

describe('WidgetAuthProvider — anonymous session restore on mount (P0.3)', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    mintAnon.mockClear()
    vi.unstubAllGlobals()
  })

  it('adopts a valid persisted token after server validation, without minting', async () => {
    persistAnonymousToken('anon-restore')
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { user: null } }) })
    vi.stubGlobal('fetch', fetchMock)

    renderWidget()

    await waitFor(() => expect(getWidgetToken()).toBe('anon-restore'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/widget/session',
      expect.objectContaining({ headers: { Authorization: 'Bearer anon-restore' } })
    )
    expect(mintAnon).not.toHaveBeenCalled()
  })

  it('refreshes the persisted token expiry on successful restore (rolling client window)', async () => {
    const KEY = `quackback:anon-token:${window.location.origin}`
    const nearExpiry = Date.now() + 60_000
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ token: 'anon-restore', expiresAt: nearExpiry })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { user: null } }) })
    )

    renderWidget()

    await waitFor(() => expect(getWidgetToken()).toBe('anon-restore'))
    const stored = JSON.parse(window.localStorage.getItem(KEY)!)
    // Active use rolls the client expiry hint forward (toward now + 7d), well
    // past the near-term expiry it started with.
    expect(stored.expiresAt).toBeGreaterThan(nearExpiry)
  })

  it('drops a persisted token the server rejects (401) and adopts nothing', async () => {
    persistAnonymousToken('stale')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    )

    renderWidget()

    await waitFor(() => expect(readPersistedToken()).toBeNull())
    expect(getWidgetToken()).toBeNull()
    expect(mintAnon).not.toHaveBeenCalled()
  })

  it('stays lazy when no token is persisted (no validate, no mint)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderWidget()
    // Let mount effects flush.
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mintAnon).not.toHaveBeenCalled()
    expect(getWidgetToken()).toBeNull()
  })

  it('skips restore when a portal session is present (portal takes precedence)', async () => {
    persistAnonymousToken('anon-should-be-ignored')
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { user: null } }) })
    vi.stubGlobal('fetch', fetchMock)

    renderWidget({ portalSessionToken: 'portal-tok' })

    await waitFor(() => expect(getWidgetToken()).toBe('portal-tok'))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/widget/session', expect.anything())
    expect(mintAnon).not.toHaveBeenCalled()
  })
})
