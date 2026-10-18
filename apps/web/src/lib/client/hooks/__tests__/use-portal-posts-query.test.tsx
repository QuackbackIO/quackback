// @vitest-environment happy-dom
/**
 * The portal feed keeps at most `maxPages` pages in memory. Once the cap is
 * reached, TanStack Query drops the oldest page every time a new one is
 * appended — so the number of pages held no longer says which page comes
 * next. Every page param must be derived from a neighbouring page's own
 * param, or the feed asks for the same page forever (PRO-1664).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const listPublicPostsFn = vi.fn()
vi.mock('@/lib/server/functions/public-posts', () => ({
  listPublicPostsFn: (...args: unknown[]) => listPublicPostsFn(...args),
  getVotedPostsFn: vi.fn(),
  getPostPermissionsFn: vi.fn(),
}))

const { usePublicPosts, flattenPublicPosts } = await import('../use-portal-posts-query')

const PAGE_SIZE = 20
const TOTAL_POSTS = 250
const LAST_PAGE = Math.ceil(TOTAL_POSTS / PAGE_SIZE) // 13
const MAX_PAGES = 8

function serverPage(page: number) {
  const start = (page - 1) * PAGE_SIZE
  const ids = Array.from({ length: PAGE_SIZE }, (_, i) => start + i)
    .filter((n) => n < TOTAL_POSTS)
    .map((n) => `post_${n}`)
  return { items: ids.map((id) => ({ id })), hasMore: start + PAGE_SIZE < TOTAL_POSTS }
}

function requestedPages(): number[] {
  return listPublicPostsFn.mock.calls.map(
    (call) => (call[0] as { data: { page: number } }).data.page
  )
}

let client: QueryClient
beforeEach(() => {
  listPublicPostsFn.mockReset()
  listPublicPostsFn.mockImplementation(async ({ data }: { data: { page: number } }) =>
    serverPage(data.page)
  )
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(cleanup)

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Render the feed and scroll it to the server's last page. */
async function scrollToEnd() {
  const hook = renderHook(() => usePublicPosts({ filters: { sort: 'new' } }), { wrapper })
  await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(1))
  for (let page = 2; page <= LAST_PAGE; page++) {
    await act(async () => {
      await hook.result.current.fetchNextPage()
    })
  }
  await waitFor(() => expect(hook.result.current.hasNextPage).toBe(false))
  return hook
}

describe('usePublicPosts', () => {
  it('keeps advancing past the maxPages cap instead of re-requesting the same page', async () => {
    const { result } = await scrollToEnd()

    expect(requestedPages()).toEqual(Array.from({ length: LAST_PAGE }, (_, i) => i + 1))

    // The in-memory window holds the newest MAX_PAGES pages, each post once.
    expect(result.current.data?.pageParams).toEqual([6, 7, 8, 9, 10, 11, 12, 13])
    const ids = flattenPublicPosts(result.current.data).map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(TOTAL_POSTS - (LAST_PAGE - MAX_PAGES) * PAGE_SIZE)
    expect(ids.at(-1)).toBe(`post_${TOTAL_POSTS - 1}`)
  })

  it('refetches each held page once after the window has slid', async () => {
    const { result } = await scrollToEnd()
    listPublicPostsFn.mockClear()

    await act(async () => {
      await result.current.refetch()
    })

    // A refetch walks the held window from its first page param forward.
    expect(requestedPages()).toEqual([6, 7, 8, 9, 10, 11, 12, 13])
    await waitFor(() =>
      expect(result.current.data?.pageParams).toEqual([6, 7, 8, 9, 10, 11, 12, 13])
    )
  })

  it('scrolls back up to the page before the window', async () => {
    const { result } = await scrollToEnd()
    listPublicPostsFn.mockClear()

    await act(async () => {
      await result.current.fetchPreviousPage()
    })

    expect(requestedPages()).toEqual([5])
    await waitFor(() =>
      expect(result.current.data?.pageParams).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
    )
    expect(flattenPublicPosts(result.current.data)[0]?.id).toBe(`post_${4 * PAGE_SIZE}`)
  })
})
