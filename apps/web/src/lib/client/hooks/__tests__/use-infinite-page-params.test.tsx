// @vitest-environment happy-dom
/**
 * Every capped infinite query (`maxPages`) must derive its next page from the
 * last page's own param, never from how many pages are held — the cap drops
 * the oldest page on each append, so the count stops at the cap and a
 * count-based param re-requests one page forever (PRO-1664). The portal feed
 * has its own test; this one covers the admin users list and the
 * notification list, which share the pattern.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const listPortalUsersFn = vi.fn()
vi.mock('@/lib/server/functions/admin', () => ({
  listPortalUsersFn: (...args: unknown[]) => listPortalUsersFn(...args),
  getPortalUserFn: vi.fn(),
}))

const getNotificationsFn = vi.fn()
vi.mock('@/lib/server/functions/notifications', () => ({
  getNotificationsFn: (...args: unknown[]) => getNotificationsFn(...args),
  getUnreadCountFn: vi.fn(),
}))

const { portalUsersInfiniteOptions } = await import('../use-users-queries')
const { useInfiniteNotifications } = await import('../use-notifications-queries')

let client: QueryClient
beforeEach(() => {
  listPortalUsersFn.mockReset()
  getNotificationsFn.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(cleanup)

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('portalUsersInfiniteOptions', () => {
  it('requests consecutive page numbers past the maxPages cap', async () => {
    const LAST_PAGE = 9 // maxPages is 5
    listPortalUsersFn.mockImplementation(async ({ data }: { data: { page: number } }) => ({
      items: [{ principalId: `user_${data.page}` }],
      hasMore: data.page < LAST_PAGE,
    }))

    const data = await client.fetchInfiniteQuery({
      ...portalUsersInfiniteOptions({ sort: 'newest' }),
      pages: LAST_PAGE,
    })

    const pages = listPortalUsersFn.mock.calls.map(
      (call) => (call[0] as { data: { page: number } }).data.page
    )
    expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(data.pageParams).toEqual([5, 6, 7, 8, 9])
    expect(data.pages.map((p) => p.items[0]?.principalId)).toEqual([
      'user_5',
      'user_6',
      'user_7',
      'user_8',
      'user_9',
    ])
  })
})

describe('useInfiniteNotifications', () => {
  it('advances the offset by the page size past the maxPages cap', async () => {
    const TOTAL = 250 // 9 pages of 30; maxPages is 5
    getNotificationsFn.mockImplementation(
      async ({ data }: { data: { offset: number; limit: number } }) => ({
        items: [{ id: `notif_${data.offset}` }],
        hasMore: data.offset + data.limit < TOTAL,
        unreadCount: 0,
      })
    )

    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await result.current.fetchNextPage()
      })
    }
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))

    const offsets = getNotificationsFn.mock.calls.map(
      (call) => (call[0] as { data: { offset: number } }).data.offset
    )
    expect(offsets).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240])
    expect(result.current.data?.pageParams).toEqual([120, 150, 180, 210, 240])
  })
})
