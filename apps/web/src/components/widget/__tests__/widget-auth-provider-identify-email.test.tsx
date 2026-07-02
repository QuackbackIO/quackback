// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken, getWidgetToken, setWidgetToken } from '@/lib/client/widget-auth'

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

const identifiedUser = {
  id: 'user_123',
  email: 'demo@example.com',
  name: 'Demo User',
  avatarUrl: null,
}

function IdentifyProbe({ onResult = vi.fn() }: { onResult?: (ok: boolean) => void }) {
  const { identifyWithEmail } = useWidgetAuth()
  return (
    <button
      type="button"
      onClick={async () => {
        onResult(await identifyWithEmail('demo@example.com', 'Demo User'))
      }}
    >
      identify
    </button>
  )
}

function renderWidget({
  hmacRequired = false,
  onResult,
}: {
  hmacRequired?: boolean
  onResult?: (ok: boolean) => void
} = {}) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <WidgetAuthProvider hmacRequired={hmacRequired}>
        <IdentifyProbe onResult={onResult} />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

describe('WidgetAuthProvider identifyWithEmail', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('uses the unverified widget identify endpoint without minting an ssoToken first', async () => {
    const onResult = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionToken: 'identified-token',
        user: identifiedUser,
        votedPostIds: [],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWidget({ onResult })
    fireEvent.click(screen.getByRole('button', { name: 'identify' }))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/api/widget/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'demo@example.com',
        email: 'demo@example.com',
        name: 'Demo User',
      }),
    })
    expect(getWidgetToken()).toBe('identified-token')
  })

  it('passes a previous anonymous token as both Bearer auth and previousToken', async () => {
    setWidgetToken('anon-token')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionToken: 'identified-token',
        user: identifiedUser,
        votedPostIds: [],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWidget()
    fireEvent.click(screen.getByRole('button', { name: 'identify' }))

    await waitFor(() => expect(getWidgetToken()).toBe('identified-token'))
    expect(fetchMock).toHaveBeenCalledWith('/api/widget/identify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer anon-token',
      },
      body: JSON.stringify({
        id: 'demo@example.com',
        email: 'demo@example.com',
        name: 'Demo User',
        previousToken: 'anon-token',
      }),
    })
  })

  it('does not run inline email capture when HMAC identity is required', async () => {
    const onResult = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderWidget({ hmacRequired: true, onResult })
    fireEvent.click(screen.getByRole('button', { name: 'identify' }))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
