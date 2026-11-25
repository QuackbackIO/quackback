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
const auth: { user: { id: string } | null; identityResolved: boolean } = {
  user: null,
  identityResolved: true,
}

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: 0,
    user: auth.user,
    identityResolved: auth.identityResolved,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/changelog', () => ({
  widgetListPublicChangelogsFn: () => Promise.resolve({ items, nextCursor: null }),
  widgetListChangelogCategoriesFn: () => Promise.resolve([]),
}))

import { useChangelogUnread } from '../use-changelog-unread'

beforeEach(() => {
  localStorage.clear()
  items = [entry(1)]
  auth.user = null
  auth.identityResolved = true
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const loaded = () =>
    qc
      .getQueryCache()
      .findAll()
      .some((q) => q.state.data !== undefined)
  return { qc, wrapper, loaded }
}

it('badges an entry published later for a visitor who never opened the Changelog tab', async () => {
  const { qc, wrapper, loaded } = setup()
  const { result } = renderHook(() => useChangelogUnread(true), { wrapper })
  // What was there at first contact is not news.
  await waitFor(() => expect(loaded()).toBe(true))
  expect(result.current.unread).toBe(0)

  items = [entry(2), entry(1)]
  await act(() => qc.invalidateQueries())
  await waitFor(() => expect(result.current.unread).toBe(1))
})

it('reads and writes no marker until the identity round trip settles', async () => {
  localStorage.setItem('quackback:changelog-seen-at', '2026-11-01T12:00:00.000Z')
  items = [entry(2), entry(1)]
  auth.user = { id: 'user_a' }
  auth.identityResolved = false
  const { wrapper, loaded } = setup()
  const hook = renderHook(() => useChangelogUnread(true), { wrapper })
  await waitFor(() => expect(loaded()).toBe(true))

  // Not yet known whose marker the old one is: nothing counts and nothing
  // moves, so it cannot land under the anonymous visitor.
  expect(hook.result.current.unread).toBe(0)
  act(() => hook.result.current.markSeen(entry(2).publishedAt))
  expect(localStorage.getItem('quackback:changelog-seen-at:anonymous')).toBeNull()
  expect(localStorage.getItem('quackback:changelog-seen-at:user_a')).toBeNull()
  expect(localStorage.getItem('quackback:changelog-seen-at')).toBe('2026-11-01T12:00:00.000Z')

  // Settled as person A: they adopt the old marker, and the later entry badges.
  auth.identityResolved = true
  hook.rerender()
  await waitFor(() =>
    expect(localStorage.getItem('quackback:changelog-seen-at:user_a')).toBe(
      '2026-11-01T12:00:00.000Z'
    )
  )
  expect(localStorage.getItem('quackback:changelog-seen-at')).toBeNull()
  expect(hook.result.current.unread).toBe(1)
})
