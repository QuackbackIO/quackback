/**
 * A page of the admin feedback list carries each post's pending merge
 * suggestion count, the badge its row shows, so the list does not need a
 * second request per page for the badges.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId } from '@quackback/ids'

const mockListInboxPosts = vi.fn()
vi.mock('../post.inbox', () => ({
  listInboxPosts: (...args: unknown[]) => mockListInboxPosts(...args),
}))

// The search mode is settled against the database; a widened one is set per test.
let searchMode = 'all'
vi.mock('../post.inbox.search', () => ({
  withInboxSearchMode: async (params: object) => ({ ...params, searchMode }),
}))

const mockCounts = vi.fn()
vi.mock('@/lib/server/domains/merge-suggestions/merge-suggestion.service', () => ({
  getMergeSuggestionCountsForPosts: (...args: unknown[]) => mockCounts(...args),
}))

const { listAdminInboxPage } = await import('../post.admin-inbox')

const A = 'post_a' as PostId
const B = 'post_b' as PostId

beforeEach(() => {
  vi.resetAllMocks()
  searchMode = 'all'
})

describe('listAdminInboxPage', () => {
  it("counts the page's posts' pending merge suggestions", async () => {
    mockListInboxPosts.mockResolvedValueOnce({
      items: [{ id: A }, { id: B }],
      nextCursor: B,
      hasMore: true,
    })
    mockCounts.mockResolvedValueOnce([{ postId: B, count: 2 }])

    const page = await listAdminInboxPage({ sort: 'newest', limit: 2 })

    expect(mockListInboxPosts).toHaveBeenCalledWith({ sort: 'newest', limit: 2, searchMode: 'all' })
    expect(mockCounts).toHaveBeenCalledWith([A, B])
    expect(page).toEqual({
      items: [{ id: A }, { id: B }],
      nextCursor: B,
      hasMore: true,
      duplicateCounts: [{ postId: B, count: 2 }],
    })
  })

  it('skips the count for an empty page', async () => {
    mockListInboxPosts.mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false })

    const page = await listAdminInboxPage({})

    expect(mockCounts).not.toHaveBeenCalled()
    expect(page.duplicateCounts).toEqual([])
  })

  it('lists with the settled search mode and says when it was widened', async () => {
    searchMode = 'similar'
    mockListInboxPosts.mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false })

    const page = await listAdminInboxPage({ search: 'integraton' })

    expect(mockListInboxPosts).toHaveBeenCalledWith({ search: 'integraton', searchMode: 'similar' })
    expect(page.searchMode).toBe('similar')
  })
})
