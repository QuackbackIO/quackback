// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

// The hook only reads `sessionVersion` off the auth context.
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ sessionVersion: 0 }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
}))
// Keep both fetches pending: presence comes from the seeded shared query, and
// the thread fetch stays pending so only the seed is under test.
vi.mock('@/lib/server/functions/widget/conversation', () => ({
  widgetGetMessengerUnreadFn: () => new Promise(() => {}),
  widgetGetMyConversationFn: () => new Promise(() => {}),
  widgetGetConversationPresenceFn: () => new Promise(() => {}),
}))

import { useConversationSummary } from '../use-messenger-summary'
import { useRefreshSummaryOnUnreadChange } from '../use-messenger-unread'
import { CONVERSATION_PRESENCE_QUERY_KEY } from '../use-messenger-presence'

function seeded(seed?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seed !== undefined) qc.setQueryData(CONVERSATION_PRESENCE_QUERY_KEY, seed)
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('useConversationSummary', () => {
  it('reads its presence verdict from the shared seeded query (no flash)', () => {
    const { result } = renderHook(() => useConversationSummary(true), {
      wrapper: seeded({ agentsOnline: true, withinOfficeHours: null, nextOpenAt: null }),
    })
    expect(result.current.agentsOnline).toBe(true)
    // Thread fetch is still pending, so no conversation yet.
    expect(result.current.conversation).toBe(null)
  })

  it('carries the seeded office-hours verdict through', () => {
    const { result } = renderHook(() => useConversationSummary(true), {
      wrapper: seeded({ agentsOnline: false, withinOfficeHours: true, nextOpenAt: null }),
    })
    expect(result.current.withinOfficeHours).toBe(true)
  })

  it('falls back to offline when there is no seed', () => {
    const { result } = renderHook(() => useConversationSummary(true), { wrapper: seeded() })
    expect(result.current.agentsOnline).toBe(false)
    expect(result.current.withinOfficeHours).toBe(null)
  })
})

describe('useRefreshSummaryOnUnreadChange', () => {
  function setup() {
    const qc = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const current = vi.fn().mockResolvedValue({ conversation: null, teamName: null })
    const older = vi.fn().mockResolvedValue({ conversation: null, teamName: null })
    return { qc, wrapper, current, older }
  }

  it('refetches the current Home card when the total moves, even with Home off screen', async () => {
    const { qc, wrapper, current, older } = setup()
    // Fetched but not observed: Home is off screen.
    await qc.fetchQuery({
      queryKey: conversationKeys.widgetConversationSummary(0),
      queryFn: current,
    })
    await qc.fetchQuery({
      queryKey: conversationKeys.widgetConversationSummary(-1),
      queryFn: older,
    })
    current.mockClear()
    older.mockClear()
    const hook = renderHook(
      ({ total }: { total: number | undefined }) => useRefreshSummaryOnUnreadChange(total),
      { wrapper, initialProps: { total: 2 } }
    )
    hook.rerender({ total: 0 })
    await vi.waitFor(() => expect(current).toHaveBeenCalledTimes(1))
    // An earlier identity's card is left alone.
    expect(older).not.toHaveBeenCalled()
  })

  it('does not count the first total after a load as a change', async () => {
    const { qc, wrapper, current } = setup()
    await qc.fetchQuery({
      queryKey: conversationKeys.widgetConversationSummary(0),
      queryFn: current,
    })
    current.mockClear()
    const hook = renderHook(
      ({ total }: { total: number | undefined }) => useRefreshSummaryOnUnreadChange(total),
      { wrapper, initialProps: { total: undefined as number | undefined } }
    )
    hook.rerender({ total: 2 })
    await new Promise((r) => setTimeout(r, 20))
    expect(current).not.toHaveBeenCalled()
    expect(qc.getQueryState(conversationKeys.widgetConversationSummary(0))?.isInvalidated).toBe(
      false
    )
  })
})
