// @vitest-environment happy-dom
/**
 * A widget opened by a signed-in portal visitor (the page hands it their
 * session) reads the messenger's unread total and conversation summary once
 * each, with that session. The identity-keyed reads must not first run without
 * it and then run again once the session is adopted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken } from '@/lib/client/widget-auth'

installInMemoryLocalStorage()

type Call = { headers?: Record<string, string> }
const reads = vi.hoisted(() => ({
  widgetGetMessengerUnreadFn: vi.fn(async (_call: Call) => ({ total: 0 })),
  widgetGetMyConversationFn: vi.fn(async (_call: Call) => ({ conversation: null, teamName: null })),
  widgetGetConversationPresenceFn: vi.fn(() => new Promise(() => {})),
}))
vi.mock('@/lib/server/functions/widget/conversation', () => reads)
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider } from '../widget-auth-provider'
import { useMessengerUnread } from '../use-messenger-unread'
import { useConversationSummary } from '../use-messenger-summary'

function MessengerReads() {
  useMessengerUnread(true)
  useConversationSummary(true)
  return null
}

function renderWidget(portalSessionToken: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <WidgetAuthProvider
        portalSessionToken={portalSessionToken}
        portalUser={
          portalSessionToken
            ? { id: 'user_1', name: 'Ada', email: 'ada@example.com', avatarUrl: null }
            : null
        }
      >
        <MessengerReads />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('WidgetAuthProvider: a portal session', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    reads.widgetGetMessengerUnreadFn.mockClear()
    reads.widgetGetMyConversationFn.mockClear()
  })

  it('reads the unread total and the conversation summary once each, with that session', async () => {
    renderWidget('portal-tok')
    await waitFor(() => expect(reads.widgetGetMyConversationFn).toHaveBeenCalled())
    await settle()

    for (const read of [reads.widgetGetMessengerUnreadFn, reads.widgetGetMyConversationFn]) {
      expect(read).toHaveBeenCalledTimes(1)
      expect(read.mock.calls[0]![0].headers).toEqual({ Authorization: 'Bearer portal-tok' })
    }
  })

  it('leaves an anonymous visitor reading once each, with no session', async () => {
    renderWidget(null)
    await waitFor(() => expect(reads.widgetGetMyConversationFn).toHaveBeenCalled())
    await settle()

    for (const read of [reads.widgetGetMessengerUnreadFn, reads.widgetGetMyConversationFn]) {
      expect(read).toHaveBeenCalledTimes(1)
      expect(read.mock.calls[0]![0].headers).toEqual({})
    }
  })
})
