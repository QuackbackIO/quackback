/**
 * The feedback route's loader warms the inbox list for an unfiltered URL, and
 * the page then reads the list keyed by the filters it derives from that same
 * URL. If the two keys differ, the warmed list is never read: the page renders
 * without it and fetches the same rows again after hydration.
 */
import { hashKey } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  defaultInboxFilters,
  inboxFacetCountsOptions,
  inboxPostsInfiniteOptions,
} from '@/lib/client/hooks/use-inbox-query'
import { inboxFiltersFromSearch } from '../use-inbox-filters'

describe('inboxFiltersFromSearch', () => {
  it('keys an unfiltered page exactly as the loader warms it', () => {
    const page = inboxFiltersFromSearch({})

    expect(hashKey(inboxPostsInfiniteOptions(page).queryKey)).toBe(
      hashKey(inboxPostsInfiniteOptions(defaultInboxFilters).queryKey)
    )
    expect(hashKey(inboxFacetCountsOptions(page).queryKey)).toBe(
      hashKey(inboxFacetCountsOptions(defaultInboxFilters).queryKey)
    )
  })

  it('sorts newest first when the URL names no sort', () => {
    expect(inboxFiltersFromSearch({}).sort).toBe('newest')
    expect(inboxFiltersFromSearch({ sort: 'votes' }).sort).toBe('votes')
  })

  it('reads list filters from the URL', () => {
    const filters = inboxFiltersFromSearch({
      status: ['open'],
      board: [],
      segments: ['segment_1'],
      minVotes: '5',
      deleted: true,
    })

    expect(filters.status).toEqual(['open'])
    expect(filters.board).toBeUndefined()
    expect(filters.segmentIds).toEqual(['segment_1'])
    expect(filters.minVotes).toBe(5)
    expect(filters.showDeleted).toBe(true)
  })
})
