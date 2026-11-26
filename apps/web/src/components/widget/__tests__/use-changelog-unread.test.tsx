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
let nextCursor: string | null = null
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
  widgetListPublicChangelogsFn: () => Promise.resolve({ items, nextCursor }),
  widgetListChangelogCategoriesFn: () => Promise.resolve([]),
}))

import { useChangelogUnread } from '../use-changelog-unread'

beforeEach(() => {
  localStorage.clear()
  items = [entry(1)]
  nextCursor = null
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
  localStorage.setItem('quackback:changelog-seen-at:user_a', '2026-11-01T12:00:00.000Z')
  items = [entry(2), entry(1)]
  auth.user = { id: 'user_a' }
  auth.identityResolved = false
  const { wrapper, loaded } = setup()
  const hook = renderHook(() => useChangelogUnread(true), { wrapper })
  await waitFor(() => expect(loaded()).toBe(true))

  // Not yet known who the visitor is: nothing counts and nothing moves, so
  // nothing lands under the anonymous visitor either.
  expect(hook.result.current.unread).toBe(0)
  act(() => hook.result.current.markSeen(entry(2).publishedAt))
  expect(localStorage.getItem('quackback:changelog-seen-at:anonymous')).toBeNull()
  expect(localStorage.getItem('quackback:changelog-seen-at:user_a')).toBe(
    '2026-11-01T12:00:00.000Z'
  )

  // Settled as person A: their marker applies, and the later entry badges.
  auth.identityResolved = true
  hook.rerender()
  await waitFor(() => expect(hook.result.current.unread).toBe(1))
})

it('ignores the marker saved before markers were kept per person', async () => {
  localStorage.setItem('quackback:changelog-seen-at', '2026-11-01T12:00:00.000Z')
  items = [entry(2), entry(1)]
  auth.user = { id: 'user_a' }
  const { wrapper } = setup()
  const hook = renderHook(() => useChangelogUnread(true), { wrapper })
  // Person A starts from their own silent baseline; the shared key is gone.
  await waitFor(() =>
    expect(localStorage.getItem('quackback:changelog-seen-at:user_a')).toBe(entry(2).publishedAt)
  )
  expect(localStorage.getItem('quackback:changelog-seen-at')).toBeNull()
  expect(hook.result.current.unread).toBe(0)
})

it('badges the first entry of a changelog that was empty at first contact', async () => {
  items = []
  const { qc, wrapper, loaded } = setup()
  const { result } = renderHook(() => useChangelogUnread(true), { wrapper })
  await waitFor(() => expect(loaded()).toBe(true))
  await waitFor(() =>
    expect(localStorage.getItem('quackback:changelog-seen-at:anonymous')).not.toBeNull()
  )

  items = [entry(1)]
  await act(() => qc.invalidateQueries())
  await waitFor(() => expect(result.current.unread).toBe(1))
})

it('reads the marker once, not on every render', async () => {
  localStorage.setItem('quackback:changelog-seen-at:anonymous', entry(1).publishedAt)
  const { wrapper, loaded } = setup()
  const hook = renderHook(() => useChangelogUnread(true), { wrapper })
  await waitFor(() => expect(loaded()).toBe(true))
  const getItem = vi.spyOn(window.localStorage, 'getItem')
  hook.rerender()
  hook.rerender()
  expect(getItem).not.toHaveBeenCalled()
  getItem.mockRestore()
})

it('re-reads the marker when another tab advances it', async () => {
  const KEY = 'quackback:changelog-seen-at:anonymous'
  localStorage.setItem(KEY, entry(1).publishedAt)
  items = [entry(3), entry(2), entry(1)]
  const { wrapper } = setup()
  const { result } = renderHook(() => useChangelogUnread(true), { wrapper })
  await waitFor(() => expect(result.current.unread).toBe(2))
  expect(result.current.newest?.id).toBe('changelog_3')

  // Another tab reads the changelog: only the native storage event fires here.
  localStorage.setItem(KEY, entry(3).publishedAt)
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
  })
  expect(result.current.unread).toBe(0)
  expect(result.current.newest).toBeNull()
})

it('ignores storage changes to unrelated keys', async () => {
  const KEY = 'quackback:changelog-seen-at:anonymous'
  localStorage.setItem(KEY, entry(1).publishedAt)
  items = [entry(3), entry(2), entry(1)]
  const { wrapper } = setup()
  const { result } = renderHook(() => useChangelogUnread(true), { wrapper })
  await waitFor(() => expect(result.current.unread).toBe(2))

  localStorage.setItem(KEY, entry(3).publishedAt)
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
  })
  expect(result.current.unread).toBe(2)
})

describe('the unread count as a lower bound', () => {
  const KEY = 'quackback:changelog-seen-at:anonymous'

  it('flags the count when every loaded entry is unread and more exist', async () => {
    localStorage.setItem(KEY, entry(1).publishedAt)
    items = [entry(3), entry(2)]
    nextCursor = 'page_2'
    const { wrapper } = setup()
    const { result } = renderHook(() => useChangelogUnread(true), { wrapper })
    await waitFor(() => expect(result.current.unread).toBe(2))
    expect(result.current.more).toBe(true)
  })

  it('is exact when the loaded pages are the whole changelog', async () => {
    localStorage.setItem(KEY, entry(1).publishedAt)
    items = [entry(3), entry(2)]
    const { wrapper } = setup()
    const { result } = renderHook(() => useChangelogUnread(true), { wrapper })
    await waitFor(() => expect(result.current.unread).toBe(2))
    expect(result.current.more).toBe(false)
  })

  it('is exact when a loaded entry is already read', async () => {
    localStorage.setItem(KEY, entry(2).publishedAt)
    items = [entry(3), entry(2)]
    nextCursor = 'page_2'
    const { wrapper } = setup()
    const { result } = renderHook(() => useChangelogUnread(true), { wrapper })
    await waitFor(() => expect(result.current.unread).toBe(1))
    expect(result.current.more).toBe(false)
  })
})
