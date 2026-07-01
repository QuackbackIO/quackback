// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The hook only reads `sessionVersion` off the auth context.
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ sessionVersion: 0 }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
}))
// Keep both fetches pending: presence comes from the seeded shared query, and
// the thread fetch (getMyConversationFn) stays pending so only the seed is under test.
vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationFn: () => new Promise(() => {}),
  getConversationPresenceFn: () => new Promise(() => {}),
}))

import { useConversationSummary } from '../use-messenger-summary'
import { CHAT_PRESENCE_QUERY_KEY } from '../use-messenger-presence'

function seeded(seed?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seed !== undefined) qc.setQueryData(CHAT_PRESENCE_QUERY_KEY, seed)
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
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
