/**
 * Each page of the admin feedback list arrives with its posts' pending merge
 * suggestion counts, and seeds the per-page counts query the rows' duplicate
 * badges read, so the badges need no request of their own.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId } from '@quackback/ids'

const mockFetchInboxPosts = vi.fn()
const mockFetchFilterCounts = vi.fn()
vi.mock('@/lib/server/functions/posts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/posts')>()),
  fetchInboxPostsForAdmin: (...args: unknown[]) => mockFetchInboxPosts(...args),
  fetchInboxFilterCounts: (...args: unknown[]) => mockFetchFilterCounts(...args),
}))

const { inboxPostsInfiniteOptions, inboxFacetCountsOptions } = await import('../use-inbox-query')
const { mergeSuggestionQueries } = await import('@/lib/client/queries/signals')

const A = 'post_a' as PostId
const B = 'post_b' as PostId
const C = 'post_c' as PostId

function page(ids: PostId[], counts: { postId: PostId; count: number }[], next: PostId | null) {
  return {
    items: ids.map((id) => ({ id, title: id })),
    nextCursor: next,
    hasMore: next !== null,
    duplicateCounts: counts,
  }
}

let client: QueryClient
beforeEach(() => {
  mockFetchInboxPosts.mockReset()
  mockFetchFilterCounts.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('inboxPostsInfiniteOptions', () => {
  it("seeds each page's duplicate counts", async () => {
    mockFetchInboxPosts
      .mockResolvedValueOnce(page([A, B], [{ postId: B, count: 2 }], B))
      .mockResolvedValueOnce(page([C], [], null))
    const options = inboxPostsInfiniteOptions({ sort: 'newest' })

    await client.fetchInfiniteQuery(options)
    expect(client.getQueryData(mergeSuggestionQueries.countsForPosts([A, B]).queryKey)).toEqual([
      { postId: B, count: 2 },
    ])

    await client.fetchInfiniteQuery({ ...options, pages: 2 })
    expect(client.getQueryData(mergeSuggestionQueries.countsForPosts([C]).queryKey)).toEqual([])
  })

  it('keeps the list pages in their own shape', async () => {
    mockFetchInboxPosts.mockResolvedValueOnce(page([A], [{ postId: A, count: 1 }], null))

    const data = await client.fetchInfiniteQuery(inboxPostsInfiniteOptions({ sort: 'newest' }))

    expect(data.pages[0]).not.toHaveProperty('duplicateCounts')
    expect(data.pages[0]?.items.map((p) => p.id)).toEqual([A])
  })
})

describe('the owner filter', () => {
  const ownerSent = (mock: typeof mockFetchInboxPosts) => mock.mock.calls[0][0].data.ownerId

  it('asks for posts with no owner when the filter is "Unassigned"', async () => {
    mockFetchInboxPosts.mockResolvedValueOnce(page([], [], null))
    mockFetchFilterCounts.mockResolvedValueOnce({})

    await client.fetchInfiniteQuery(inboxPostsInfiniteOptions({ owner: 'unassigned' }))
    await client.fetchQuery(inboxFacetCountsOptions({ owner: 'unassigned' }))

    expect(ownerSent(mockFetchInboxPosts)).toBeNull()
    expect(ownerSent(mockFetchFilterCounts)).toBeNull()
  })

  it('passes an owner through, and leaves no owner filter unset', async () => {
    mockFetchInboxPosts
      .mockResolvedValueOnce(page([], [], null))
      .mockResolvedValueOnce(page([], [], null))

    await client.fetchInfiniteQuery(inboxPostsInfiniteOptions({ owner: 'principal_lea' }))
    await client.fetchInfiniteQuery(inboxPostsInfiniteOptions({}))

    expect(mockFetchInboxPosts.mock.calls[0][0].data.ownerId).toBe('principal_lea')
    expect(mockFetchInboxPosts.mock.calls[1][0].data.ownerId).toBeUndefined()
  })
})
