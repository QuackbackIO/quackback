// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
// Never resolves: the value under test is the SSR seed in the cache, not a fetch.
vi.mock('@/lib/server/functions/conversation', () => ({
  getConversationPresenceFn: () => new Promise(() => {}),
}))

import {
  useConversationPresence,
  markAgentPresentInCache,
  CHAT_PRESENCE_QUERY_KEY,
} from '../use-messenger-presence'

function seeded(seed?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seed !== undefined) qc.setQueryData(CHAT_PRESENCE_QUERY_KEY, seed)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

describe('useConversationPresence', () => {
  it('returns the SSR-seeded verdict without fetching', () => {
    const { wrapper } = seeded({ agentsOnline: true, withinOfficeHours: null, nextOpenAt: null })
    const { result } = renderHook(() => useConversationPresence(true), { wrapper })
    expect(result.current.agentsOnline).toBe(true)
  })

  it('falls back to offline when there is no seed', () => {
    const { wrapper } = seeded()
    const { result } = renderHook(() => useConversationPresence(true), { wrapper })
    expect(result.current).toEqual({
      agentsOnline: false,
      withinOfficeHours: null,
      nextOpenAt: null,
    })
  })

  it('reports offline when disabled (chat off)', () => {
    const { wrapper } = seeded()
    const { result } = renderHook(() => useConversationPresence(false), { wrapper })
    expect(result.current.agentsOnline).toBe(false)
  })
})

describe('markAgentPresentInCache', () => {
  it('flips agentsOnline true while preserving office-hours fields', () => {
    const { qc } = seeded({
      agentsOnline: false,
      withinOfficeHours: false,
      nextOpenAt: '2026-01-01T09:00:00Z',
    })
    markAgentPresentInCache(qc)
    expect(qc.getQueryData(CHAT_PRESENCE_QUERY_KEY)).toEqual({
      agentsOnline: true,
      withinOfficeHours: false,
      nextOpenAt: '2026-01-01T09:00:00Z',
    })
  })

  it('seeds an online verdict when the cache is empty', () => {
    const { qc } = seeded()
    markAgentPresentInCache(qc)
    expect(qc.getQueryData(CHAT_PRESENCE_QUERY_KEY)).toEqual({
      agentsOnline: true,
      withinOfficeHours: null,
      nextOpenAt: null,
    })
  })
})
