// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const entry = (n: number) => ({
  id: `changelog_${n}`,
  title: `Entry ${n}`,
  content: '',
  publishedAt: `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`,
  categories: [],
})
let items = [entry(1)]

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ sessionVersion: 0, user: null }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/changelog', () => ({
  widgetListPublicChangelogsFn: () => Promise.resolve({ items, nextCursor: null }),
  widgetListChangelogCategoriesFn: () => Promise.resolve([]),
}))

import { useChangelogUnread } from '../use-changelog-unread'

beforeEach(() => localStorage.clear())

it('badges an entry published later for a visitor who never opened the Changelog tab', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useChangelogUnread(true), { wrapper })
  // What was there at first contact is not news.
  await waitFor(() =>
    expect(
      qc
        .getQueryCache()
        .findAll()
        .some((q) => q.state.data !== undefined)
    ).toBe(true)
  )
  expect(result.current.unread).toBe(0)

  items = [entry(2), entry(1)]
  await act(() => qc.invalidateQueries())
  await waitFor(() => expect(result.current.unread).toBe(1))
})
