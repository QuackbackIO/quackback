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

const mockCounts = vi.fn()
vi.mock('@/lib/server/domains/merge-suggestions/merge-suggestion.service', () => ({
  getMergeSuggestionCountsForPosts: (...args: unknown[]) => mockCounts(...args),
}))

const { listAdminInboxPage } = await import('../post.admin-inbox')

const A = 'post_a' as PostId
const B = 'post_b' as PostId

beforeEach(() => {
  vi.resetAllMocks()
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

    expect(mockListInboxPosts).toHaveBeenCalledWith({ sort: 'newest', limit: 2 })
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
})
