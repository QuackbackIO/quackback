// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/client/widget-auth', () => ({
  setWidgetToken: vi.fn(),
  clearWidgetToken: vi.fn(),
  getWidgetToken: vi.fn(() => 'widget-token'),
  persistAnonymousToken: vi.fn(),
  readPersistedToken: vi.fn(() => null),
  clearPersistedToken: vi.fn(),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider } from '../widget-auth-provider'

function fromHost(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: window.parent }))
  })
}

function deviceLinks(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/widget/device')
}

describe('WidgetAuthProvider device linking', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WidgetAuthProvider initialLocale="en">
          <span />
        </WidgetAuthProvider>
      </QueryClientProvider>
    )
  })

  it('links a device the host sends once per session', () => {
    fromHost({ type: 'quackback:device', data: 'device-1' })
    fromHost({ type: 'quackback:device', data: 'device-1' })
    expect(deviceLinks(fetchMock)).toHaveLength(1)
  })

  it('forgets the device when the host sends null, so nothing links until a new one arrives', () => {
    fromHost({ type: 'quackback:device', data: 'device-1' })
    fromHost({ type: 'quackback:device', data: null })
    expect(deviceLinks(fetchMock)).toHaveLength(1)
    fromHost({ type: 'quackback:device', data: 'device-1' })
    expect(deviceLinks(fetchMock)).toHaveLength(2)
  })
})
