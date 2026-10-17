// @vitest-environment happy-dom
/**
 * usePublicPosts: the panel counts ride the first feed page, and a change of
 * sort alone reuses them rather than asking the server to count again.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PublicFeedbackFilters } from '@/lib/shared/types'

const listPublicPostsFn = vi.fn()
vi.mock('@/lib/server/functions/public-posts', () => ({
  listPublicPostsFn: (...a: unknown[]) => listPublicPostsFn(...a),
  getVotedPostsFn: vi.fn(),
  getPostPermissionsFn: vi.fn(),
}))
import { usePublicPosts } from '../use-portal-posts-query'

const counts = { statuses: { open: 3 }, boards: {}, tags: {}, total: 3, views: null }

beforeEach(() => {
  listPublicPostsFn.mockReset()
  listPublicPostsFn.mockImplementation(async ({ data }: { data: { facets?: boolean } }) => ({
    items: [],
    hasMore: false,
    ...(data.facets !== false && { facets: counts }),
  }))
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return renderHook(
    ({ filters }: { filters: PublicFeedbackFilters }) => usePublicPosts({ filters }),
    { wrapper, initialProps: { filters: { sort: 'top' } } }
  )
}

const sentFacets = (call: number) =>
  (listPublicPostsFn.mock.calls[call]![0] as { data: { facets?: boolean } }).data.facets

describe('usePublicPosts', () => {
  it('reuses the counts when only the sort changes', async () => {
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.data?.pages[0]?.facets).toEqual(counts))

    rerender({ filters: { sort: 'new' } })
    await waitFor(() => expect(listPublicPostsFn).toHaveBeenCalledTimes(2))
    expect(sentFacets(1)).toBe(false)
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))
    expect(result.current.data?.pages[0]?.facets).toEqual(counts)
  })

  it('counts again when a filter changes', async () => {
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.data?.pages[0]?.facets).toEqual(counts))

    rerender({ filters: { sort: 'top', search: 'dark' } })
    await waitFor(() => expect(listPublicPostsFn).toHaveBeenCalledTimes(2))
    expect(sentFacets(1)).toBeUndefined()
  })

  it('counts again when the same feed refetches (a vote changed the numbers)', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.data?.pages[0]?.facets).toEqual(counts))

    await result.current.refetch()
    expect(sentFacets(1)).toBeUndefined()
  })
})
