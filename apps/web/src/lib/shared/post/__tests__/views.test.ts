/**
 * Saved feedback-inbox views: the client-safe filter model, its zod validation,
 * and the view↔InboxFilters translation. A view is a saved filter SET, not a
 * search — `search` never survives the round trip.
 */
import { describe, it, expect } from 'vitest'
import {
  postViewFiltersSchema,
  inboxFiltersToPostViewFilters,
  postViewFiltersToInboxFilters,
} from '../views'

describe('postViewFiltersSchema', () => {
  it('accepts an empty filter set (a view of the whole inbox)', () => {
    expect(postViewFiltersSchema.parse({})).toEqual({})
  })

  it('accepts a full filter set', () => {
    const parsed = postViewFiltersSchema.parse({
      status: ['open', 'planned'],
      board: ['board_123'],
      tags: ['post_tag_a', 'post_tag_b'],
      segmentIds: ['segment_x'],
      owner: 'unassigned',
      responded: 'unresponded',
      minVotes: 5,
      minComments: 2,
      hasDuplicates: true,
      showDeleted: true,
      sort: 'votes',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
      updatedBefore: '2026-07-01',
    })
    expect(parsed.owner).toBe('unassigned')
    expect(parsed.sort).toBe('votes')
  })

  it('rejects an unknown sort', () => {
    expect(() => postViewFiltersSchema.parse({ sort: 'trending' })).toThrow()
  })

  it('rejects a search term — a view saves filters, not a query', () => {
    expect(() => postViewFiltersSchema.parse({ search: 'billing' })).toThrow()
  })

  it('rejects a negative vote floor', () => {
    expect(() => postViewFiltersSchema.parse({ minVotes: -1 })).toThrow()
  })
})

describe('inboxFiltersToPostViewFilters', () => {
  it('drops the search term but keeps every filter', () => {
    const saved = inboxFiltersToPostViewFilters({
      search: 'billing',
      status: ['open'],
      board: ['board_1'],
      owner: 'unassigned',
      sort: 'newest',
    })
    expect(saved).toEqual({
      status: ['open'],
      board: ['board_1'],
      owner: 'unassigned',
      sort: 'newest',
    })
    expect('search' in saved).toBe(false)
  })

  it('drops empty arrays and absent values so the stored JSON stays minimal', () => {
    expect(inboxFiltersToPostViewFilters({ status: [], tags: [], minVotes: undefined })).toEqual({})
  })

  it('drops a default-valued responded flag', () => {
    expect(inboxFiltersToPostViewFilters({ responded: 'all' })).toEqual({})
  })
})

describe('postViewFiltersToInboxFilters', () => {
  it('round-trips through the inbox filter shape', () => {
    const filters = {
      status: ['open'],
      tags: ['post_tag_a'],
      responded: 'unresponded' as const,
      sort: 'oldest' as const,
    }
    expect(postViewFiltersToInboxFilters(filters)).toEqual(filters)
  })

  it('restores an empty view to empty inbox filters', () => {
    expect(postViewFiltersToInboxFilters({})).toEqual({})
  })
})
